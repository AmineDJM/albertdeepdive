import { eq } from "drizzle-orm";
import type { Browser } from "playwright";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { createLogger } from "@/server/logger";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { ensureBrand } from "@/server/brand/service";
import { recordCost } from "@/server/creative/service";
import { estimateCostCents } from "@/server/ai/pricing";
import type { BrandSystem } from "@/lib/brand/system";
import type { EditionDocument } from "@/lib/publication/document";
import { blocksOf, type EditionDesign } from "@/lib/design/model";
import { describeDirection } from "@/lib/design/identity";
import { readSignals } from "@/lib/design/signals";
import { candidatesForBlock, candidatesForSurface, coverCandidates, type Candidate } from "@/lib/design/candidates";
import { describeDiff, diffDesigns } from "@/lib/design/diff";
import type { PrintOptions } from "@/lib/design/pages";
import { chooseLayout } from "@/server/ai/services/layout-critic";
import { layoutDesign } from "./render/pdf";
import { shootPages } from "./shots";
import { directionFor } from "./identity";
import { storedFocals } from "./memory";
import { currentDesign, designEdition, saveDesign } from "./service";

const log = createLogger("design:tournament");

/**
 * Two or three ways to do it, drawn, looked at, and one chosen.
 *
 * §41 says never ship the first valid layout and §82 asks for the cover and the major pages to be
 * given a tournament. Everything else in the engine can be argued from the design; this cannot,
 * because "which of these three good pages is the best page" is a question about how they look.
 *
 * So the candidates are really rendered — the same print pipeline that makes the PDF — and really
 * looked at. With no model connected the score decides, which is a worse answer than looking but a
 * far better one than taking whichever came first.
 */

export type TournamentScope = { kind: "cover" } | { kind: "block"; id: string } | { kind: "surface"; id: string };

export type TournamentOptions = {
  scope?: TournamentScope;
  /** How many to draw. Each one is a full layout pass, so this is the cost dial. */
  entrants?: number;
  local?: boolean;
  browser?: Browser;
  document?: EditionDocument;
  print?: PrintOptions;
  userId?: string | null;
  onProgress?: (message: string) => void;
};

export type TournamentEntrant = {
  id: string;
  label: string;
  score: number;
  why: string;
  current: boolean;
  /** The page it was judged on, and whether a picture of it was taken. */
  page: number | null;
  shot: boolean;
};

export type TournamentResult = {
  design: EditionDesign;
  revision: number;
  entrants: TournamentEntrant[];
  winner: string;
  /** Why the winner won: the art director's sentence, or the arithmetic's. */
  because: string;
  decidedBy: "seen" | "measured";
  changed: string;
  costCents: number;
};

export async function runTournament(editionId: string, options: TournamentOptions = {}): Promise<TournamentResult> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition?.organizationId) throw new Error(`Edition ${editionId} not found`);
  const organizationId = edition.organizationId;
  const say = options.onProgress ?? (() => {});

  const existing = await currentDesign(editionId);
  const design = existing ?? (await designEdition(editionId, { local: options.local })).design;

  const document = options.document ?? (await buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true }));
  const publication = edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId) }) : null;
  const [{ resolved: direction }, brand, focals] = await Promise.all([
    directionFor(editionId),
    ensureBrand(organizationId),
    storedFocals(document.media.map((media) => media.id)),
  ]);
  const signals = readSignals(document);
  const ctx = { signals, direction };

  const scope = options.scope ?? { kind: "cover" as const };
  const wanted = Math.max(2, Math.min(5, options.entrants ?? 3));
  const candidates =
    scope.kind === "cover" ? coverCandidates(design, ctx, wanted) : scope.kind === "block" ? candidatesForBlock(design, scope.id, ctx, wanted) : candidatesForSurface(design, scope.id, ctx, wanted);

  if (candidates.length < 2) {
    const only = candidates[0];
    return {
      design,
      revision: design.revision,
      entrants: only ? [{ id: only.id, label: only.label, score: only.score, why: only.why, current: only.current, page: null, shot: false }] : [],
      winner: only?.id ?? "",
      because: "there was only one way to draw it",
      decidedBy: "measured",
      changed: "Nothing changed.",
      costCents: 0,
    };
  }

  const base = {
    document,
    direction,
    brand: brand.system as BrandSystem,
    locale: publication?.language ?? "en",
    focals,
    print: options.print,
    browser: options.browser,
  };

  // Every entrant is really laid out. A tournament between designs that were never drawn is a
  // tournament between guesses.
  const drawn: { candidate: Candidate; page: number | null; png: Buffer | null }[] = [];
  const subject = (scope.kind === "cover" ? blocksOf(design).find((block) => block.role === "cover")?.id : scope.kind === "block" ? scope.id : null) ?? null;

  for (const [index, candidate] of candidates.entries()) {
    say(`Drawing option ${index + 1} of ${candidates.length}: ${candidate.label}`);
    const laid = await layoutDesign({ ...base, design: candidate.design });
    const page = pageOf(laid.plan, subject, scope);
    let png: Buffer | null = null;
    if (!options.local && page) {
      const shots = await shootPages(laid.markup, [page], { browser: options.browser });
      png = shots[0]?.png ?? null;
    }
    drawn.push({ candidate, page, png });
  }

  let winner = drawn[0];
  let because = `it scores best: ${drawn[0].candidate.why}`;
  let decidedBy: TournamentResult["decidedBy"] = "measured";
  let costCents = 0;

  const withPictures = drawn.filter((entry) => entry.png);
  if (withPictures.length >= 2) {
    try {
      say("Looking at them");
      const result = await chooseLayout({
        options: withPictures.map((entry) => ({ label: entry.candidate.label, png: entry.png! })),
        intent: describeDirection(direction),
        question: scope.kind === "cover" ? "Which of these covers would you run?" : "Which of these pages would you run?",
      });
      if (result) {
        winner = withPictures[result.choice.winner - 1] ?? winner;
        because = result.choice.because;
        decidedBy = "seen";
        costCents = estimateCostCents(result.model, result.inputTokens, result.outputTokens);
        await recordCost({ organizationId, provider: "openai", operation: "layout-tournament", model: result.model, costCents });
      }
    } catch (error) {
      log.warn("the tournament could not be judged by eye; the score decides", { editionId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  let saved = design;
  let changed = "Nothing changed.";
  if (!winner.candidate.current) {
    const diff = diffDesigns(design, winner.candidate.design);
    changed = describeDiff(diff);
    saved = await saveDesign(editionId, winner.candidate.design, { summary: `${scope.kind} tournament: ${winner.candidate.label} — ${because}`, userId: options.userId ?? null });
  }

  log.info("tournament", { editionId, scope: scope.kind, entrants: drawn.length, winner: winner.candidate.label, decidedBy });
  return {
    design: saved,
    revision: saved.revision,
    entrants: drawn.map((entry) => ({
      id: entry.candidate.id,
      label: entry.candidate.label,
      score: entry.candidate.score,
      why: entry.candidate.why,
      current: entry.candidate.current,
      page: entry.page,
      shot: Boolean(entry.png),
    })),
    winner: winner.candidate.id,
    because,
    decidedBy,
    changed,
    costCents,
  };
}

/** The page an entrant should be judged on: the one its subject landed on, or the cover. */
function pageOf(plan: Awaited<ReturnType<typeof layoutDesign>>["plan"], subject: string | null, scope: TournamentScope): number | null {
  if (subject && plan.pageOfBlock[subject]) return plan.pageOfBlock[subject];
  if (scope.kind === "cover") return plan.pages.find((page) => page.surfaces.some((surface) => surface.kind === "cover"))?.number ?? plan.pages[0]?.number ?? null;
  if (scope.kind === "surface") {
    const page = plan.pages.find((candidate) => candidate.surfaces.some((surface) => surface.surfaceId === scope.id));
    return page?.number ?? null;
  }
  return plan.pages[0]?.number ?? null;
}
