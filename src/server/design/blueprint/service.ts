import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { env } from "@/server/env";
import { createLogger } from "@/server/logger";
import { brandRecordFor } from "@/server/brand/service";
import { activeGenome, activeIdentity, saveIdentity } from "@/server/design/identity";
import { DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { saturation } from "@/lib/brand/colour";
import { inferPersonality } from "@/lib/brand/discover";
import type { GenomePatch } from "@/lib/design/genome";
import type { PublicationIdentity } from "@/lib/design/identity";
import { describeEvidence, isNearMonochrome, paperName, type BlueprintEvidence, type BlueprintKind } from "@/lib/design/blueprint";
import { readBlueprint, type BlueprintReading } from "@/server/ai/services/blueprint-reader";
import { readBlueprintFile } from "./read";

const log = createLogger("design:blueprint");

/**
 * From somebody's file to what their title is, in two passes that never pretend to be one.
 *
 * The measurements come first and are never overruled: a page that is 595 × 842 pt is A4 whatever
 * anybody thinks of it, and a red measured as #c8102e does not become "a warm red". What the model
 * adds is the half a file cannot state — the character of the thing, and which of its headings are
 * rubrics rather than one month's news.
 *
 * With no model connected, the measurements alone still produce a usable blueprint and the screen
 * says so. That is not a stand-in for understanding: the colours, the type, the page and the
 * repeated headings were all read out of the file. What is missing is judgement, and the reading
 * admits to missing it rather than inventing a mood with a straight face.
 */

export type BlueprintRubric = { name: string; purpose: string; component: PublicationIdentity["rubrics"][number]["component"] };

export type BlueprintProposal = {
  /** The file it was read from, or "brand" when Briefly designed one instead. */
  kind: BlueprintKind | "brand";
  fileName: string | null;
  evidence: BlueprintEvidence;
  /** What the title becomes if this is adopted. */
  identity: Partial<PublicationIdentity>;
  rubrics: BlueprintRubric[];
  /**
   * A palette and a type pairing for the *workspace brand*, measured rather than invented.
   *
   * Offered beside the blueprint rather than folded into it: colours belong to a company and a
   * blueprint belongs to one of its titles, and silently repainting a workspace from one PDF would
   * be a change nobody asked for.
   */
  brand: { palette: { brand: string; accent: string | null }; fonts: { heading: string | null; body: string | null } } | null;
  summary: string;
  confidence: "high" | "medium" | "low";
  readBy: "model" | "measured";
  notes: string[];
};

/* ── What the measurements alone justify ──────────────────────────────────────────────────── */

/**
 * The dials a file's own numbers support, and no others.
 *
 * Three things are genuinely measurable and worth having even with no model in the loop: how
 * colourful the thing is, how densely it is set, and how much of it is photographs. Everything else
 * — whether it is playful, how formal it is, how much it varies between pages — is judgement, and
 * a number invented for it would be indistinguishable from one that was read.
 */
export function dialsFromEvidence(evidence: BlueprintEvidence): GenomePatch {
  const patch: GenomePatch = {};
  const coloured = evidence.colours.filter((colour) => !isNearMonochrome(colour.hex));
  if (evidence.colours.length) {
    const strength = coloured.reduce((n, colour) => n + saturation(colour.hex) * colour.weight, 0);
    patch.colourIntensity = Math.max(0, Math.min(1, Math.round(Math.min(1, strength * 1.6 + coloured.length * 0.08) * 100) / 100));
  }
  if (evidence.page && evidence.counts.pages > 0 && evidence.counts.words > 0) {
    // Words per page against what a page of that size comfortably holds. A4 of body copy is ~500.
    const area = (evidence.page.widthPt * evidence.page.heightPt) / (595 * 842);
    const perPage = evidence.counts.words / evidence.counts.pages / Math.max(0.2, area);
    patch.density = Math.max(0, Math.min(1, Math.round((perPage / 700) * 100) / 100));
  }
  if (evidence.counts.pages > 0) {
    const perPage = evidence.counts.images / evidence.counts.pages;
    patch.imageUsage = perPage >= 1.5 ? "led" : perPage >= 0.4 ? "balanced" : "sparse";
  }
  return patch;
}

/**
 * The headings that came back more than once, which is as close to a rubric as counting gets.
 *
 * Used only when no model read the file. It is honest about what it is — the screen calls them
 * candidates — because a heading repeated across pages might equally be a running header, and
 * telling the two apart is reading rather than arithmetic.
 */
export function rubricsFromEvidence(evidence: BlueprintEvidence): BlueprintRubric[] {
  const repeated = evidence.outline.filter((item) => item.occurrences > 1 && item.text.length <= 40);
  const pool = repeated.length ? repeated : evidence.outline.filter((item) => item.level <= 2 && item.text.length <= 40);
  return pool.slice(0, 8).map((item) => ({ name: item.text, purpose: "", component: null }));
}

function paletteFromEvidence(evidence: BlueprintEvidence): BlueprintProposal["brand"] {
  const coloured = evidence.colours.filter((colour) => !isNearMonochrome(colour.hex));
  const heading = evidence.fonts.find((font) => font.role === "heading") ?? evidence.fonts[0] ?? null;
  const body = evidence.fonts.find((font) => font.role === "body") ?? evidence.fonts[1] ?? null;
  if (!coloured.length && !heading) return null;
  return {
    palette: { brand: coloured[0]?.hex ?? "#111111", accent: coloured[1]?.hex ?? null },
    fonts: { heading: heading?.family ?? null, body: body?.family ?? null },
  };
}

function gridFromEvidence(evidence: BlueprintEvidence): Partial<PublicationIdentity["grid"]> {
  // One measurement genuinely decides a grid: an email is a single column, always. Everything else
  // is a judgement about a page and is left to the pass that can see it.
  if (evidence.kind === "html") return { columns: 1, shape: "single" };
  return {};
}

/* ── The two ways in ──────────────────────────────────────────────────────────────────────── */

export async function proposeFromFile(publicationId: string, bytes: Buffer, fileName: string): Promise<BlueprintProposal> {
  const { kind, evidence, shots } = await readBlueprintFile(bytes, fileName);
  const publication = await db.query.publications.findFirst({ where: await scoped(s.publications.organizationId, eq(s.publications.id, publicationId)) });
  if (!publication) throw new Error(`Publication ${publicationId} not found`);
  const [organization, brand] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(s.organizations.id, publication.organizationId) }),
    brandRecordFor({ organizationId: publication.organizationId, publicationId: publication.id }).catch(() => null),
  ]);
  const system = ((brand?.system as BrandSystem | undefined) ?? DEFAULT_BRAND_SYSTEM) as BrandSystem;

  const dials = dialsFromEvidence(evidence);
  const measuredPersonality = evidence.fonts.length
    ? inferPersonality({ colours: evidence.colours.map((colour) => colour.hex), fonts: evidence.fonts.map((font) => font.family), logoUrl: null }).personality
    : null;

  let reading: BlueprintReading | null = null;
  if (env.AI_PROVIDER === "openai") {
    try {
      const result = await readBlueprint({
        evidence: describeEvidence(evidence),
        organizationName: organization?.name ?? "the workspace",
        publicationName: publication.name,
        brand: `palette ${system.colours.brand}, personality ${system.personality}`,
        shots: shots.slice(0, 3).map((shot, at) => ({ dataUrl: `data:image/jpeg;base64,${shot.toString("base64")}`, label: `Page ${at + 1}`, detail: "high" as const })),
      });
      reading = result.output;
    } catch (err) {
      log.warn("the model could not read the blueprint; the measurements stand on their own", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  const notes = [...evidence.notes];
  if (!reading) {
    notes.push(
      env.AI_PROVIDER === "openai"
        ? "The reading could not be completed, so what you see is what was measured in the file — the colours, the type, the page and the headings that repeat."
        : "No model is connected, so this is what was measured in the file: the colours, the type, the page and the headings that repeat. Connect one and Briefly will also read the layout.",
    );
  }

  const identity: Partial<PublicationIdentity> = {
    genome: { ...dials, ...(reading?.genome ?? {}) },
    personality: reading?.personality ?? measuredPersonality,
    grid: { ...gridFromEvidence(evidence), ...(reading?.grid ?? {}) },
    coverStyle: reading?.coverStyle ?? null,
    sectionOpener: reading?.sectionOpener ?? null,
    ...(reading ? { masthead: reading.masthead } : {}),
  };

  const rubrics = reading?.sections.length ? reading.sections : rubricsFromEvidence(evidence);
  const paper = evidence.page ? (paperName(evidence.page.widthPt, evidence.page.heightPt) ?? `${Math.round(evidence.page.widthPt)} × ${Math.round(evidence.page.heightPt)} pt`) : null;

  return {
    kind,
    fileName,
    evidence,
    identity,
    rubrics,
    brand: paletteFromEvidence(evidence),
    summary:
      reading?.summary ??
      [
        paper ? `${paper}, ${evidence.counts.pages} page(s).` : null,
        evidence.colours.length ? `${evidence.colours.filter((colour) => !isNearMonochrome(colour.hex)).length} colour(s) beyond ink and paper.` : null,
        evidence.fonts.length ? `Set in ${evidence.fonts.map((font) => font.family).slice(0, 2).join(" and ")}.` : null,
        rubrics.length ? `${rubrics.length} recurring heading(s) found.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    confidence: reading?.confidence ?? (evidence.fonts.length && evidence.outline.length ? "medium" : "low"),
    readBy: reading ? "model" : "measured",
    notes,
  };
}

/**
 * No file, so the brand is the model.
 *
 * The other half of the ask, and the one a workspace on its first day needs: compose a title from
 * the charte the organisation already has. There is no reading to do — every value is known — so
 * this asks no model anything. The genome is the workspace's own, the type personality is the
 * brand's, and the rubrics are the small set of pieces Briefly knows how to compose well, named in
 * the title's own language by the interface rather than invented here.
 */
export async function proposeFromBrand(publicationId: string, rubricNames: { name: string; component: PublicationIdentity["rubrics"][number]["component"] }[]): Promise<BlueprintProposal> {
  const publication = await db.query.publications.findFirst({ where: await scoped(s.publications.organizationId, eq(s.publications.id, publicationId)) });
  if (!publication) throw new Error(`Publication ${publicationId} not found`);
  const [genome, brand] = await Promise.all([activeGenome(publication.organizationId), brandRecordFor({ organizationId: publication.organizationId, publicationId: publication.id }).catch(() => null)]);
  const system = ((brand?.system as BrandSystem | undefined) ?? DEFAULT_BRAND_SYSTEM) as BrandSystem;

  return {
    kind: "brand",
    fileName: null,
    evidence: {
      kind: "html",
      colours: [system.colours.brand, system.colours.accent].filter((hex): hex is string => !!hex).map((hex, at) => ({ hex, weight: 1 - at * 0.3, where: "brand" })),
      fonts: [],
      page: null,
      outline: [],
      counts: { pages: 0, words: 0, images: 0, headings: 0 },
      notes: [],
    },
    identity: {
      genome: {},
      personality: system.personality as PublicationIdentity["personality"],
      coverStyle: genome.editorial.imageUsage === "sparse" ? "typographic" : "image-led",
      sectionOpener: genome.editorial.minimalism > 0.6 ? "rule-and-number" : "full-title",
      masthead: { composition: genome.editorial.formality > 0.6 ? "classic" : "left", wordmark: system.logo.wordmarkUrl || system.logo.markUrl ? "both" : "type", rule: genome.editorial.ornament > 0.25 },
    },
    rubrics: rubricNames.map((rubric) => ({ name: rubric.name, purpose: "", component: rubric.component })),
    brand: null,
    summary: "",
    confidence: "high",
    readBy: "measured",
    notes: [],
  };
}

/** Adopting one: a new version of the title's identity, with the account of where it came from. */
export async function adoptBlueprint(publicationId: string, proposal: BlueprintProposal, userId?: string | null): Promise<PublicationIdentity> {
  const current = await activeIdentity(publicationId);
  return saveIdentity(
    publicationId,
    {
      ...proposal.identity,
      rubrics: proposal.rubrics,
      // What Briefly already knows how to compose, out of what was found — the rest keep their own
      // names and are composed as ordinary sections.
      recurring: [...new Set(proposal.rubrics.map((rubric) => rubric.component).filter((component): component is NonNullable<typeof component> => !!component))],
      source: {
        kind: proposal.kind === "brand" ? "brand" : "uploaded",
        fileName: proposal.fileName,
        summary: proposal.summary,
        confidence: proposal.confidence,
        readBy: proposal.readBy,
        at: new Date().toISOString(),
      },
      name: current.name,
    },
    { userId, reason: proposal.fileName ? `Read from ${proposal.fileName}` : "Designed from the brand" },
  );
}

