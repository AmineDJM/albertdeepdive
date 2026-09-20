import { blocksOf, mayChange, surfacesOf, type DesignBlock, type EditionDesign } from "./model";
import { COMPOSITIONS, IMPORTANCE_WEIGHT, PICTURE_ROLES, isComposition, wantsPicture, type BlockRole, type Importance } from "./roles";
import type { EditionSignals } from "./signals";
import type { ResolvedDirection } from "./identity";
import { buildScale, isDistinguishable } from "./type-scale";
import { composeHeadline } from "./headline";
import { candidatesFor } from "./compose";
import type { CropShape } from "./crop";

/**
 * The critic that can be run without looking.
 *
 * §42 of the design brief asks for a LayoutCritic, and says plainly that half of it is measurable
 * and half is not. This is the measurable half: everything about a design that can be established
 * from the design itself — a hierarchy that is flat, a composition used four times running, a
 * picture placed twice in one issue, a type scale whose headline and deck are the same size.
 *
 * It is deliberately separate from the half that needs eyes. A finding here is reproducible,
 * explainable and free, so it is found first and fixed first; what is left for the model to look at
 * is what only looking can catch (§34) rather than arithmetic it would be asked to redo.
 *
 * Every finding carries a remedy where a deterministic one exists, because a critique nothing can
 * act on is a report, and §80 asks for an art director that watches the result rather than one that
 * files complaints.
 */

export const DIMENSIONS = ["hierarchy", "rhythm", "typography", "imagery", "density", "structure", "accessibility"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/**
 * How much a finding matters.
 *
 * BLOCKING is "this cannot go out": a page that spills, a composition no renderer draws. SERIOUS is
 * "an editorial designer would send this back". MINOR is a note. The loop acts on the first two and
 * records the third, which is what stops a refinement pass from churning an issue over a nit.
 */
export const SEVERITIES = ["BLOCKING", "SERIOUS", "MINOR"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** A change the engine knows how to make. `none` is honest: some findings need a person. */
export type Remedy =
  | { kind: "composition"; blockId: string; to: string }
  | { kind: "importance"; blockId: string; to: Importance }
  | { kind: "drop"; blockId: string }
  | { kind: "crop"; blockId: string; shape: CropShape }
  | { kind: "picture"; blockId: string; mediaId: string | null }
  | { kind: "none" };

export type DesignFinding = {
  /** Stable across rounds, so "still wrong" and "wrong again" are different things. */
  id: string;
  dimension: Dimension;
  severity: Severity;
  /** What is wrong, in the words an art director would use with an editor. */
  issue: string;
  remedy: Remedy;
  blockId: string | null;
  surfaceId: string | null;
  page: number | null;
  /** Measured from the design, or seen in the render. */
  source: "measured" | "seen";
  evidence: Record<string, string | number>;
};

export type InspectInput = {
  design: EditionDesign;
  signals: EditionSignals;
  direction: ResolvedDirection;
  /** What print measured, when print has run. */
  print?: {
    overflowing: number[];
    underfilled: number[];
    relaxations: { surfaceId: string; blockId: string; fromPage: number; reason: string }[];
    pages: number;
  };
};

const finding = (input: Omit<DesignFinding, "source" | "blockId" | "surfaceId" | "page" | "evidence"> & Partial<Pick<DesignFinding, "blockId" | "surfaceId" | "page" | "evidence">>): DesignFinding => ({
  blockId: null,
  surfaceId: null,
  page: null,
  evidence: {},
  source: "measured",
  ...input,
});

export function inspectDesign(input: InspectInput): DesignFinding[] {
  return [...hierarchy(input), ...rhythm(input), ...typography(input), ...imagery(input), ...density(input), ...structure(input), ...accessibility(input)].sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
  );
}

/* ── Hierarchy: is this an edition, or a list? ───────────────────────────────────────────── */

function hierarchy({ design, signals }: InspectInput): DesignFinding[] {
  const out: DesignFinding[] = [];
  const blocks = blocksOf(design);
  const stories = blocks.filter((block) => block.articleId);
  if (!stories.length) return out;

  if (!blocks.some((block) => block.role === "cover")) {
    out.push(finding({ id: "hierarchy:no-cover", dimension: "hierarchy", severity: "SERIOUS", issue: "The edition has no cover: it begins with whatever happens to be first.", remedy: { kind: "none" } }));
  }

  const leads = stories.filter((block) => block.importance === "LEAD" || block.importance === "COVER");
  if (leads.length > 3) {
    // A lead is what the reader meets first. Four of them is none of them.
    const extra = leads.slice(3).find((block) => mayChange(block, "position"));
    out.push(
      finding({
        id: "hierarchy:too-many-leads",
        dimension: "hierarchy",
        severity: "SERIOUS",
        issue: `${leads.length} stories are set as the lead. Everything cannot be first.`,
        remedy: extra ? { kind: "importance", blockId: extra.id, to: "MAJOR" } : { kind: "none" },
        blockId: extra?.id ?? null,
        evidence: { leads: leads.length },
      }),
    );
  }

  const weights = new Set(stories.map((block) => block.importance));
  if (weights.size === 1 && stories.length > 3 && signals.hasLead) {
    out.push(
      finding({
        id: "hierarchy:flat",
        dimension: "hierarchy",
        severity: "SERIOUS",
        issue: "Every story is set at the same weight, so the page cannot say which one matters.",
        remedy: { kind: "none" },
        evidence: { stories: stories.length },
      }),
    );
  }
  return out;
}

/* ── Rhythm: does the issue have a pulse, or a template? ─────────────────────────────────── */

function rhythm({ design, signals, direction }: InspectInput): DesignFinding[] {
  const out: DesignFinding[] = [];
  const blocks = blocksOf(design);
  const limit = Math.max(2, direction.rhythm.repeatLimit);

  let run: DesignBlock[] = [];
  for (const block of [...blocks, null]) {
    const same = block && run.length && run[0].composition === block.composition && run[0].role === block.role;
    if (same && block) {
      run.push(block);
      continue;
    }
    if (run.length > limit) {
      const offender = run.slice(limit).find((candidate) => mayChange(candidate, "composition"));
      const alternative = offender ? alternativeFor(offender, signals, direction) : null;
      out.push(
        finding({
          id: `rhythm:run:${run[0].role}:${run[0].composition}`,
          dimension: "rhythm",
          severity: "SERIOUS",
          issue: `${run.length} ${run[0].role} blocks in a row are drawn the same way. An edition with one shape is a template.`,
          remedy: offender && alternative ? { kind: "composition", blockId: offender.id, to: alternative } : { kind: "none" },
          blockId: offender?.id ?? null,
          evidence: { run: run.length, composition: run[0].composition },
        }),
      );
    }
    run = block ? [block] : [];
  }

  const surfaces = surfacesOf(design);
  const flow = surfaces.filter((surface) => surface.kind === "flow").length;
  if (surfaces.length > 6 && flow === surfaces.length) {
    out.push(
      finding({
        id: "rhythm:no-reset",
        dimension: "rhythm",
        severity: "MINOR",
        issue: "The issue runs from beginning to end at one pace, with nothing to break it — no opener, no picture page, no quote.",
        remedy: { kind: "none" },
        evidence: { surfaces: surfaces.length },
      }),
    );
  }
  return out;
}

/** A composition this block could legitimately be drawn as instead, given its own material. */
function alternativeFor(block: DesignBlock, signals: EditionSignals, direction: ResolvedDirection): string | null {
  const story = signals.stories.find((candidate) => candidate.articleId === block.articleId) ?? null;
  const candidates = candidatesFor(block.role as BlockRole, { importance: block.importance, story, direction, recent: [block.composition], density: direction.genome.density });
  return candidates.find((candidate) => candidate !== block.composition) ?? block.alternatives.find((candidate) => candidate !== block.composition) ?? null;
}

/* ── Typography ──────────────────────────────────────────────────────────────────────────── */

/** A4's text width in points, which is the tightest measure any of these headlines has to survive. */
const PRINT_MEASURE_PT = (210 - 35) * 2.83465;

function typography({ design, signals, direction }: InspectInput): DesignFinding[] {
  const out: DesignFinding[] = [];
  const scale = buildScale(direction, "editorial", "print");
  const headlines = new Map(signals.stories.map((story) => [story.articleId, story.headline]));

  for (const block of blocksOf(design)) {
    const element = block.elements.find((candidate) => candidate.role === "headline");
    const text = block.articleId ? headlines.get(block.articleId) : null;
    if (!element || !text) continue;
    const style = scale.roles[(element.style.type ?? "headline") as keyof typeof scale.roles];
    if (!style) continue;

    const composed = composeHeadline(text, style, {
      maxWidth: PRINT_MEASURE_PT * (block.constraints.maxWidth ?? 1),
      maxLines: element.constraints.maxHeadlineLines ?? block.constraints.maxHeadlineLines ?? 3,
    });
    if (!composed.fits) {
      out.push(
        finding({
          id: `typography:headline:${block.id}`,
          dimension: "typography",
          severity: "SERIOUS",
          issue: `“${text.slice(0, 60)}${text.length > 60 ? "…" : ""}” cannot be set in the space the ${block.role} gives it: it takes ${composed.lines.length} lines.`,
          // Only a person can shorten a headline, so there is nothing to apply automatically.
          remedy: { kind: "none" },
          blockId: block.id,
          evidence: { lines: composed.lines.length, wanted: element.constraints.maxHeadlineLines ?? 3 },
        }),
      );
      continue;
    }
    if (composed.problems.includes("stranded-word") || composed.problems.includes("dangling-break")) {
      out.push(
        finding({
          id: `typography:break:${block.id}`,
          dimension: "typography",
          severity: "MINOR",
          issue: composed.problems.includes("stranded-word")
            ? `The ${block.role}'s headline leaves one word alone on its last line.`
            : `The ${block.role}'s headline breaks after a word the sense carries on from.`,
          remedy: { kind: "none" },
          blockId: block.id,
        }),
      );
    }
  }

  for (const medium of ["print", "web", "email"] as const) {
    const mediumScale = buildScale(direction, "editorial", medium);
    if (!isDistinguishable(mediumScale)) {
      out.push(
        finding({
          id: `typography:flat-scale:${medium}`,
          dimension: "typography",
          severity: "SERIOUS",
          issue: `In ${medium}, the levels of the type scale are too close to tell apart — a headline that reads as a paragraph.`,
          remedy: { kind: "none" },
          evidence: { medium },
        }),
      );
    }
  }
  return out;
}

/* ── Imagery ─────────────────────────────────────────────────────────────────────────────── */

function imagery({ design, signals }: InspectInput): DesignFinding[] {
  const out: DesignFinding[] = [];
  const blocks = blocksOf(design);

  const used = new Map<string, string[]>();
  for (const block of blocks) {
    for (const element of block.elements) {
      if (element.content.kind !== "media") continue;
      used.set(element.content.mediaId, [...(used.get(element.content.mediaId) ?? []), block.id]);
    }
  }
  for (const [mediaId, where] of used) {
    if (where.length < 2) continue;
    const later = blocks.find((block) => block.id === where[where.length - 1] && mayChange(block, "image"));
    out.push(
      finding({
        id: `imagery:repeated:${mediaId}`,
        dimension: "imagery",
        severity: "SERIOUS",
        issue: "The same photograph is used twice in one issue.",
        remedy: later ? { kind: "picture", blockId: later.id, mediaId: null } : { kind: "none" },
        blockId: later?.id ?? null,
        evidence: { mediaId, places: where.length },
      }),
    );
  }

  for (const block of blocks) {
    if (!PICTURE_ROLES.includes(block.role)) continue;
    // Only a composition drawn around a photograph can be missing one. A cover set `typographic`
    // and a hero set `headline-first` open on words on purpose, and reporting those as empty
    // frames told three perfectly good issues they could not go out.
    if (!wantsPicture(block.role, block.composition)) continue;
    const hasPicture = block.elements.some((element) => element.content.kind === "media");
    if (hasPicture) continue;
    // A cover and a hero are not droppable — an issue needs a way in. What they can do is open on
    // words, which is what an art director does when the photograph does not exist.
    const remedy: Remedy =
      block.role === "cover" || block.role === "hero"
        ? { kind: "composition", blockId: block.id, to: block.role === "cover" ? "typographic" : "headline-first" }
        : { kind: "drop", blockId: block.id };
    out.push(
      finding({
        id: `imagery:empty-frame:${block.id}`,
        dimension: "imagery",
        severity: "BLOCKING",
        issue: `A ${block.role} block is set to lead with a photograph and has none: an empty frame with a caption under it.`,
        remedy,
        blockId: block.id,
      }),
    );
  }

  // Pictures the edition has and never placed. Not a defect on its own — a defect when there are
  // plenty and the issue is running as unbroken text.
  const placed = used.size;
  if (signals.counts.usablePictures >= 4 && placed <= 1) {
    out.push(
      finding({
        id: "imagery:unused",
        dimension: "imagery",
        severity: "MINOR",
        issue: `The edition has ${signals.counts.usablePictures} usable photographs and the design placed ${placed}.`,
        remedy: { kind: "none" },
        evidence: { available: signals.counts.usablePictures, placed },
      }),
    );
  }
  return out;
}

/* ── Density: what the paper said ────────────────────────────────────────────────────────── */

function density({ print }: InspectInput): DesignFinding[] {
  if (!print) return [];
  const out: DesignFinding[] = [];
  for (const page of print.overflowing) {
    out.push(
      finding({
        id: `density:overflow:${page}`,
        dimension: "density",
        severity: "BLOCKING",
        issue: `Page ${page} spills off the sheet.`,
        remedy: { kind: "none" },
        page,
      }),
    );
  }
  if (print.underfilled.length > Math.max(2, print.pages * 0.25)) {
    out.push(
      finding({
        id: "density:underfilled",
        dimension: "density",
        severity: "SERIOUS",
        issue: `${print.underfilled.length} of ${print.pages} pages are more than a quarter empty, which reads as paper spent rather than space given.`,
        remedy: { kind: "none" },
        evidence: { underfilled: print.underfilled.length, pages: print.pages },
      }),
    );
  }
  for (const relaxation of print.relaxations) {
    out.push(
      finding({
        id: `density:relaxed:${relaxation.blockId}`,
        dimension: "density",
        severity: "MINOR",
        issue: `On page ${relaxation.fromPage}, ${relaxation.reason}, so it was moved to the next page.`,
        remedy: { kind: "none" },
        blockId: relaxation.blockId,
        surfaceId: relaxation.surfaceId,
        page: relaxation.fromPage,
      }),
    );
  }
  return out;
}

/* ── Structure: can this be drawn at all ─────────────────────────────────────────────────── */

function structure({ design, signals }: InspectInput): DesignFinding[] {
  const out: DesignFinding[] = [];
  const byArticle = new Map(signals.stories.map((story) => [story.articleId, story]));

  for (const block of blocksOf(design)) {
    if (!isComposition(block.role, block.composition)) {
      out.push(
        finding({
          id: `structure:unknown-composition:${block.id}`,
          dimension: "structure",
          severity: "BLOCKING",
          issue: `No renderer draws a ${block.role} as “${block.composition}”.`,
          remedy: { kind: "composition", blockId: block.id, to: COMPOSITIONS[block.role][0] },
          blockId: block.id,
        }),
      );
      continue;
    }
    const story = block.articleId ? byArticle.get(block.articleId) : null;
    const needsPicture = /image|photo|portrait|full-bleed|collage/.test(block.composition);
    if (needsPicture && story && story.usablePictures === 0 && mayChange(block, "composition")) {
      const alternative = COMPOSITIONS[block.role].find((candidate) => !/image|photo|portrait|full-bleed|collage/.test(candidate));
      out.push(
        finding({
          id: `structure:composition-without-picture:${block.id}`,
          dimension: "structure",
          severity: "BLOCKING",
          issue: `“${block.composition}” needs a photograph and this story has none.`,
          remedy: alternative ? { kind: "composition", blockId: block.id, to: alternative } : { kind: "none" },
          blockId: block.id,
        }),
      );
    }
  }

  for (const surface of surfacesOf(design)) {
    if (surface.kind !== "opener") continue;
    if (surface.blocks.length) continue;
    out.push(finding({ id: `structure:empty-opener:${surface.id}`, dimension: "structure", severity: "SERIOUS", issue: "A section opens onto nothing.", remedy: { kind: "none" }, surfaceId: surface.id }));
  }
  return out;
}

/* ── Accessibility, which is part of the design rather than a pass afterwards ────────────── */

function accessibility({ design }: InspectInput): DesignFinding[] {
  const out: DesignFinding[] = [];
  const blocks = blocksOf(design);
  const stories = blocks.filter((block) => block.articleId);
  const headed = stories.filter((block) => block.elements.some((element) => element.role === "headline"));
  if (stories.length && headed.length < stories.length) {
    out.push(
      finding({
        id: "accessibility:unheaded",
        dimension: "accessibility",
        severity: "MINOR",
        issue: `${stories.length - headed.length} stories are placed with no headline, so a reader skimming the outline cannot find them.`,
        remedy: { kind: "none" },
        evidence: { unheaded: stories.length - headed.length },
      }),
    );
  }
  return out;
}

/* ── Reading the verdict ─────────────────────────────────────────────────────────────────── */

export function blocking(findings: readonly DesignFinding[]): DesignFinding[] {
  return findings.filter((item) => item.severity === "BLOCKING");
}

export function actionable(findings: readonly DesignFinding[]): DesignFinding[] {
  return findings.filter((item) => item.remedy.kind !== "none" && item.severity !== "MINOR");
}

/**
 * The issue's own report card, in one line.
 *
 * §101's question is "could this plausibly have been designed by an excellent editorial designer?".
 * Nothing here can answer that on its own — but an issue with a blocking finding certainly could
 * not have been, and saying so plainly is more use than a score.
 */
export function describeFindings(findings: readonly DesignFinding[]): string {
  if (!findings.length) return "Nothing to fix: the design measures clean.";
  const counts = SEVERITIES.map((severity) => ({ severity, n: findings.filter((item) => item.severity === severity).length })).filter((entry) => entry.n);
  const words = counts.map((entry) => `${entry.n} ${entry.severity === "BLOCKING" ? "that must be fixed" : entry.severity === "SERIOUS" ? "an art director would send back" : "worth noting"}`);
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}: ${words.join(", ")}.`;
}

/** Highest first, and within a severity the ones the engine can actually act on. */
export function ranked(findings: readonly DesignFinding[]): DesignFinding[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const byRemedy = Number(b.remedy.kind !== "none") - Number(a.remedy.kind !== "none");
    if (byRemedy !== 0) return byRemedy;
    return IMPORTANCE_WEIGHT[importanceOf(a)] - IMPORTANCE_WEIGHT[importanceOf(b)];
  });
}

function importanceOf(item: DesignFinding): Importance {
  return item.severity === "BLOCKING" ? "COVER" : item.severity === "SERIOUS" ? "MAJOR" : "BRIEF";
}
