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
import { describeFindings, inspectDesign, ranked, type DesignFinding } from "@/lib/design/critic";
import { applyRemedies, describeChanges, type AppliedChange, type SkippedChange } from "@/lib/design/revise";
import type { PrintOptions, PrintPlan } from "@/lib/design/pages";
import { critiqueLayout, seenFindings, type LayoutCritique } from "@/server/ai/services/layout-critic";
import { layoutDesign } from "./render/pdf";
import { pagesWorthSeeing, shootPages } from "./shots";
import { directionFor } from "./identity";
import { storedFocals } from "./memory";
import { currentDesign, designEdition, saveDesign } from "./service";

const log = createLogger("design:refine");

/**
 * Render, look, revise — and then look again.
 *
 * §80 of the design brief: the art director must watch the result. Not approve a plan, not read a
 * report — watch the thing that was actually made, and change it. §81 asks for that loop to be
 * bounded, because a system that iterates until it is happy is a system that never ships.
 *
 * Each round does four things in the same order a person would: lay the issue out on paper,
 * measure what the paper says, look at the pages that are worth looking at, and make the changes
 * the critique implies. It stops the moment there is nothing left worth changing, which is usually
 * after one round and occasionally after none.
 *
 * The loop runs without a model. What it loses is the half of the critique that needs eyes; what
 * it keeps is everything measurable, which is enough to catch an empty frame, a composition no
 * renderer draws and one shape repeated five times. A design that is merely good beats a dialog box.
 */

export type RefineOptions = {
  /** How many times round. Two is the default: the first fixes, the second confirms. */
  rounds?: number;
  /** No model at all — the golden tests and the terrain runs need the same answer twice. */
  local?: boolean;
  /** Take screenshots and ask a model to look at them. On unless `local`. */
  look?: boolean;
  browser?: Browser;
  document?: EditionDocument;
  print?: PrintOptions;
  userId?: string | null;
  onProgress?: (message: string) => void;
};

export type RefineRound = {
  round: number;
  findings: DesignFinding[];
  applied: AppliedChange[];
  skipped: SkippedChange[];
  /** What the model said, when it looked. */
  verdict: LayoutCritique["verdict"] | null;
  summary: string | null;
  pages: number;
  shots: number;
  costCents: number;
  /** What changed, in one sentence, for the person watching. */
  said: string;
};

export type RefineResult = {
  design: EditionDesign;
  revision: number;
  rounds: RefineRound[];
  /** What is still wrong when the loop stopped — reported, never hidden. */
  remaining: DesignFinding[];
  plan: PrintPlan;
  markup: string;
  costCents: number;
  stoppedBecause: "clean" | "nothing-left-to-change" | "out-of-rounds";
};

export async function refineEditionDesign(editionId: string, options: RefineOptions = {}): Promise<RefineResult> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition?.organizationId) throw new Error(`Edition ${editionId} not found`);
  const organizationId = edition.organizationId;
  const say = options.onProgress ?? (() => {});

  const existing = await currentDesign(editionId);
  let design = existing ?? (await designEdition(editionId, { local: options.local })).design;

  const document = options.document ?? (await buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true }));
  const publication = edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId) }) : null;
  const [{ resolved: direction }, brand, focals] = await Promise.all([
    directionFor(editionId),
    ensureBrand(organizationId),
    storedFocals(document.media.map((media) => media.id)),
  ]);
  const signals = readSignals(document);

  const base = {
    document,
    direction,
    brand: brand.system as BrandSystem,
    locale: publication?.language ?? "en",
    focals,
    print: options.print,
    browser: options.browser,
  };

  const rounds: RefineRound[] = [];
  const maxRounds = Math.max(1, options.rounds ?? 2);
  const look = options.look ?? !options.local;
  let laid = await layoutDesign({ ...base, design });
  let remaining: DesignFinding[] = [];
  let stoppedBecause: RefineResult["stoppedBecause"] = "out-of-rounds";
  let costCents = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    say(`Round ${round}: reading the issue as it came out`);
    const measured = inspectDesign({
      design,
      signals,
      direction,
      print: {
        overflowing: laid.report.overflowing,
        underfilled: laid.report.underfilled,
        relaxations: laid.plan.relaxations,
        pages: laid.plan.pages.length,
      },
    });

    let seen: DesignFinding[] = [];
    let verdict: LayoutCritique["verdict"] | null = null;
    let summary: string | null = null;
    let shots = 0;
    let roundCost = 0;

    if (look) {
      try {
        const wanted = pagesWorthSeeing(laid.plan, laid.measures);
        say(`Round ${round}: looking at ${wanted.length} page${wanted.length === 1 ? "" : "s"}`);
        const pictures = await shootPages(laid.markup, wanted, { browser: options.browser });
        shots = pictures.length;
        const blocks = blocksOf(design);
        const critique = await critiqueLayout({
          shots: pictures.map((shot) => ({ label: shot.label, png: shot.png })),
          intent: describeDirection(direction),
          blocks: blocks.map((block) => ({
            id: block.id,
            role: block.role,
            composition: block.composition,
            importance: block.importance,
            headline: document.articles.find((article) => article.id === block.articleId)?.headline ?? null,
          })),
          alreadyKnown: measured.map((finding) => finding.issue),
        });
        if (critique) {
          verdict = critique.critique.verdict;
          summary = critique.critique.summary;
          seen = seenFindings(critique.critique, {
            blockIds: new Set(blocks.map((block) => block.id)),
            roleOf: new Map(blocks.map((block) => [block.id, block.role])),
            pages: new Set(laid.plan.pages.map((page) => page.number)),
          });
          roundCost = estimateCostCents(critique.model, critique.inputTokens, critique.outputTokens);
          costCents += roundCost;
          await recordCost({ organizationId, provider: "openai", operation: "layout-critic", model: critique.model, costCents: roundCost });
        }
      } catch (error) {
        // Looking is the expensive half and the one that can fail. The measurable findings stand.
        log.warn("the layout critic could not look; the measurements stand", { editionId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const findings = ranked([...measured, ...seen]);
    const revised = applyRemedies(design, findings);
    remaining = findings;

    rounds.push({
      round,
      findings,
      applied: revised.applied,
      skipped: revised.skipped,
      verdict,
      summary,
      pages: laid.plan.pages.length,
      shots,
      costCents: roundCost,
      said: revised.applied.length ? describeChanges(revised.applied) : describeFindings(findings),
    });

    if (!revised.applied.length) {
      stoppedBecause = findings.some((finding) => finding.severity !== "MINOR") ? "nothing-left-to-change" : "clean";
      break;
    }

    design = revised.design;
    say(`Round ${round}: ${describeChanges(revised.applied)}`);
    laid = await layoutDesign({ ...base, design });
    if (round === maxRounds) stoppedBecause = "out-of-rounds";
  }

  // Only a design that actually changed is stored: a refinement that changed nothing must not
  // produce a revision, or every run would look like work.
  let saved = design;
  if (rounds.some((entry) => entry.applied.length)) {
    const changes = rounds.flatMap((entry) => entry.applied).length;
    saved = await saveDesign(editionId, design, {
      summary: `Refined after looking at the pages: ${changes} change${changes === 1 ? "" : "s"}`,
      userId: options.userId ?? null,
    });
  }

  return { design: saved, revision: saved.revision, rounds, remaining, plan: laid.plan, markup: laid.markup, costCents, stoppedBecause };
}
