import { z } from "zod";
import { BLOCK_ROLES, ELEMENT_ROLES, IMPORTANCE, OUTPUT_MEDIA, SURFACE_KINDS, defaultComposition, isComposition, type BlockRole } from "./roles";

/**
 * How an edition is composed, separately from what it says and from how any one medium draws it.
 *
 * Briefly's model has always been content plus a page plan: an article, and page 7 with the
 * template `ARTICLE_TWO_COLUMN` on it. That can express *where* things go and nothing about *why* —
 * which story leads, what must not break, what may shrink when the space runs out — so the email
 * renderer, the web page and the print pass each re-derived an answer and arrived at three
 * different publications.
 *
 * This is the missing middle. It holds intent: roles, hierarchy, constraints and references to
 * tokens and content. It holds no pixels, no CSS and no page numbers. Print resolves it into pages
 * and coordinates, the web into a responsive document, email into tables — three readings of one
 * art direction rather than three art directions.
 *
 * Four properties are load-bearing, and the tests here exist to hold each one:
 *
 *  - **Nothing is copied.** Every piece of content is a reference into the `EditionDocument`, so a
 *    correction to an article is a correction everywhere and the formats cannot drift apart.
 *  - **Everything is addressable.** Blocks and elements carry stable ids, because "make *this*
 *    bigger", locking page 3, recomputing only what changed and comparing two design versions all
 *    need something to point at.
 *  - **Values are roles.** A block asks for `display-l` on `surface-brand`, never `48px` on
 *    `#1F3A5F`, so a publication's identity can be restyled without re-laying out an issue.
 *  - **Updates are immutable.** A revision produces a new design; the previous one stays exactly as
 *    it was rendered, which is what makes undo and before/after honest rather than approximate.
 */

export const DESIGN_SCHEMA_VERSION = "1" as const;

/* ── What a piece of the design points at ─────────────────────────────────────────────────── */

/**
 * A reference into the edition's content.
 *
 * Never the content itself. The one exception is `text`, which is copy the design owns — a label, a
 * rule's caption, "continued on page 14" — and which no editor wrote.
 */
export const contentRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("article"),
    articleId: z.string(),
    part: z.enum(["headline", "kicker", "standfirst", "byline", "body", "excerpt", "pullquote"]),
    /** For `body`: the article blocks this element carries. Absent means all of them. */
    blockIds: z.array(z.string()).optional(),
  }),
  z.object({ kind: z.literal("media"), mediaId: z.string(), /** Which stored crop to use; absent means the natural frame. */ cropId: z.string().optional() }),
  z.object({ kind: z.literal("section"), sectionId: z.string(), part: z.enum(["name", "kicker", "number"]) }),
  z.object({ kind: z.literal("meta"), part: z.enum(["masthead", "tagline", "issueLabel", "date", "editorial", "credits", "contact", "website", "toc", "page"]) }),
  z.object({ kind: z.literal("fact"), articleId: z.string(), factId: z.string() }),
  z.object({ kind: z.literal("text"), text: z.string().max(400) }),
]);
export type ContentRef = z.infer<typeof contentRefSchema>;

/* ── Style, as roles rather than values ───────────────────────────────────────────────────── */

/** The typographic roles a publication's scale resolves. Generated per brand, never hardcoded. */
export const TYPE_ROLES = ["display-xl", "display-l", "headline", "subheadline", "deck", "body", "body-small", "caption", "metadata", "label"] as const;
export type TypeRole = (typeof TYPE_ROLES)[number];

/** The surfaces the brand compiles, each with its own proven contrast. */
export const SURFACE_ROLES = ["paper", "ink", "brand", "accent", "muted"] as const;
export type SurfaceRole = (typeof SURFACE_ROLES)[number];

export const styleRefSchema = z.object({
  type: z.enum(TYPE_ROLES).optional(),
  surface: z.enum(SURFACE_ROLES).optional(),
  /** A step on the publication's spacing scale, not a pixel count. */
  spaceBefore: z.number().int().min(0).max(8).optional(),
  spaceAfter: z.number().int().min(0).max(8).optional(),
  /**
   * How much visual weight this carries, 0–1.
   *
   * Not a font size: the renderer decides what weight means on a page and in an inbox. It is the
   * one number "give the lead story more importance" moves.
   */
  emphasis: z.number().min(0).max(1).optional(),
  /** Whether a rule sits above or below. Editorial design's cheapest and most abused tool. */
  ruleAbove: z.boolean().optional(),
  ruleBelow: z.boolean().optional(),
  /** Reverse out of the surface — light type on a dark field. Contrast is still enforced. */
  reversed: z.boolean().optional(),
});
export type StyleRef = z.infer<typeof styleRefSchema>;

/* ── Constraints, which are what makes this a layout model rather than a description ──────── */

export const constraintsSchema = z.object({
  /**
   * What survives when the space runs out, 0–1.
   *
   * The resolver drops, shrinks or moves the lowest priority first. A lead story's picture and a
   * sponsor's mark both want to be big; only one of them is allowed to win.
   */
  priority: z.number().min(0).max(1).default(0.5),
  /** Characters per line. The measure is a typographic decision, so it is stated, not inherited. */
  minMeasure: z.number().int().min(20).max(120).optional(),
  maxMeasure: z.number().int().min(20).max(120).optional(),
  minColumns: z.number().int().min(1).max(6).optional(),
  maxColumns: z.number().int().min(1).max(6).optional(),
  /** Width relative to the surface's measure, 0–1. A resolver may narrow but never exceed it. */
  minWidth: z.number().min(0).max(1).optional(),
  maxWidth: z.number().min(0).max(1).optional(),
  /** Picture aspect the composition wants. Null means whatever the photograph is. */
  aspect: z.number().positive().nullable().optional(),
  /** This block may not be split across surfaces. A quote broken over a page turn is not a quote. */
  keepTogether: z.boolean().optional(),
  /** Nothing may break immediately after this — the rule that stops orphan headings. */
  keepWithNext: z.boolean().optional(),
  /** Never start a surface with this block. */
  avoidBreakBefore: z.boolean().optional(),
  /** Bleeds past the trim. Print honours it; email ignores it; the web decides. */
  fullBleed: z.boolean().optional(),
  /** Stay inside the safe area whatever the medium does. */
  safeArea: z.boolean().optional(),
  /** The most lines a headline may take before the typography engine recomposes it. */
  maxHeadlineLines: z.number().int().min(1).max(6).optional(),
  /** Words, for the excerpting decisions email and social have to make. */
  maxWords: z.number().int().min(10).max(4000).optional(),
});
export type Constraints = z.infer<typeof constraintsSchema>;

export const DEFAULT_CONSTRAINTS: Constraints = { priority: 0.5 };

/* ── The graph ───────────────────────────────────────────────────────────────────────────── */

export const designElementSchema = z.object({
  id: z.string().min(1),
  role: z.enum(ELEMENT_ROLES),
  content: contentRefSchema,
  style: styleRefSchema.default({}),
  constraints: constraintsSchema.default({ priority: 0.5 }),
  /** A medium that should not draw this at all — a page number in an email, a CTA in print. */
  omitIn: z.array(z.enum(OUTPUT_MEDIA)).default([]),
});
export type DesignElement = z.infer<typeof designElementSchema>;

/**
 * What one medium does differently, when it genuinely must.
 *
 * §69 of the brief: a hero photograph that works on the web and not in an inbox is one override,
 * not a second edition. Anything not named here is inherited, so an override cannot quietly become
 * a fork.
 */
export const blockOverrideSchema = z.object({
  composition: z.string().optional(),
  style: styleRefSchema.optional(),
  constraints: constraintsSchema.partial().optional(),
  /** Replace one element's content — usually a picture — for this medium only. */
  content: z.record(z.string(), contentRefSchema).optional(),
  omit: z.boolean().optional(),
});
export type BlockOverride = z.infer<typeof blockOverrideSchema>;

export const designBlockSchema = z.object({
  id: z.string().min(1),
  role: z.enum(BLOCK_ROLES),
  /** One legitimate way to draw this role. Validated against the role's own list. */
  composition: z.string().min(1),
  importance: z.enum(IMPORTANCE).default("STANDARD"),
  /** The story this block is about, when it is about one. */
  storyId: z.string().nullable().default(null),
  articleId: z.string().nullable().default(null),
  elements: z.array(designElementSchema).default([]),
  style: styleRefSchema.default({}),
  constraints: constraintsSchema.default({ priority: 0.5 }),
  overrides: z.partialRecord(z.enum(OUTPUT_MEDIA), blockOverrideSchema).default({}),
  /**
   * Held against redesign.
   *
   * An empty array locks the block entirely; naming aspects locks only those, so "keep this crop
   * but find a better composition" is expressible. A redesign that ignores a lock is a bug, not a
   * judgement call.
   */
  locked: z.boolean().default(false),
  lockedAspects: z.array(z.enum(["composition", "image", "type", "colour", "position"])).default([]),
  /** Compositions considered and not chosen, kept so "change layout" offers real alternatives. */
  alternatives: z.array(z.string()).default([]),
  /** Why this composition, in one line, for the console and for the person who asks. */
  rationale: z.string().max(280).nullable().default(null),
});
export type DesignBlock = z.infer<typeof designBlockSchema>;

export const designSurfaceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(SURFACE_KINDS).default("flow"),
  blocks: z.array(designBlockSchema).default([]),
  style: styleRefSchema.default({}),
  /** Print may not break inside this surface: it is one page, or one spread. */
  atomic: z.boolean().default(false),
  locked: z.boolean().default(false),
  /** What this surface is for, in the design plan's words: "visual reset", "data spread". */
  intent: z.string().max(200).nullable().default(null),
});
export type DesignSurface = z.infer<typeof designSurfaceSchema>;

export const designSectionSchema = z.object({
  id: z.string().min(1),
  /** The editorial section this belongs to, or null for front and back matter. */
  sectionId: z.string().nullable().default(null),
  name: z.string().max(120),
  surfaces: z.array(designSurfaceSchema).default([]),
  style: styleRefSchema.default({}),
});
export type DesignSection = z.infer<typeof designSectionSchema>;

/**
 * The grid the publication is composed on, as intent rather than as CSS.
 *
 * One number the renderers all understand — twelve columns is twelve columns on a page and in a
 * browser — plus the shape choice that decides whether this publication reads as a newspaper, a
 * magazine or a report.
 */
export const gridSchema = z.object({
  columns: z.number().int().min(1).max(16).default(12),
  /** Gutter as a fraction of a column. */
  gutter: z.number().min(0).max(1).default(0.25),
  shape: z.enum(["single", "two-column", "three-column", "asymmetric", "modular", "digital-12"]).default("digital-12"),
  /** Baseline grid step, in the same relative unit the type scale uses. Null means none. */
  baseline: z.number().positive().nullable().default(null),
  margins: z.object({ top: z.number().min(0), right: z.number().min(0), bottom: z.number().min(0), left: z.number().min(0) }).default({ top: 1, right: 1, bottom: 1, left: 1 }),
});
export type DesignGrid = z.infer<typeof gridSchema>;

export const editionDesignSchema = z.object({
  schemaVersion: z.literal(DESIGN_SCHEMA_VERSION),
  editionId: z.string(),
  /** The publication identity this was composed under, so a restyle knows what it is replacing. */
  identityId: z.string().nullable().default(null),
  /** The art direction this issue was given, by id — the reasoning lives with the director. */
  artDirectionId: z.string().nullable().default(null),
  grid: gridSchema,
  sections: z.array(designSectionSchema).default([]),
  /** Which media this design was composed for. A renderer for a medium not listed is a mistake. */
  media: z.array(z.enum(OUTPUT_MEDIA)).default(["print", "web", "email"]),
  /** Bumped by every revision; the pair (editionId, revision) identifies a rendered result. */
  revision: z.number().int().min(0).default(0),
  /** The engine that composed it, so a published issue can be reproduced by the same code. */
  engine: z.string().default("design-engine/1"),
  createdAt: z.string(),
  notes: z.string().max(2000).nullable().default(null),
});
export type EditionDesign = z.infer<typeof editionDesignSchema>;

/* ── Construction ────────────────────────────────────────────────────────────────────────── */

let counter = 0;

/** Ids are readable on purpose: a design is read by people in logs, findings and conversations. */
export function designId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyDesign(editionId: string, grid: Partial<DesignGrid> = {}): EditionDesign {
  return editionDesignSchema.parse({
    schemaVersion: DESIGN_SCHEMA_VERSION,
    editionId,
    grid: gridSchema.parse(grid),
    sections: [],
    createdAt: new Date().toISOString(),
  });
}

export function element(role: DesignElement["role"], content: ContentRef, extra: Partial<Omit<DesignElement, "id" | "role" | "content">> = {}): DesignElement {
  return designElementSchema.parse({ id: designId("el"), role, content, ...extra });
}

export function block(role: BlockRole, extra: Partial<Omit<DesignBlock, "id" | "role">> = {}): DesignBlock {
  const composition = extra.composition && isComposition(role, extra.composition) ? extra.composition : defaultComposition(role);
  return designBlockSchema.parse({ id: designId("bl"), role, ...extra, composition });
}

export function surface(extra: Partial<Omit<DesignSurface, "id">> = {}): DesignSurface {
  return designSurfaceSchema.parse({ id: designId("sf"), ...extra });
}

export function section(name: string, extra: Partial<Omit<DesignSection, "id" | "name">> = {}): DesignSection {
  return designSectionSchema.parse({ id: designId("sc"), name, ...extra });
}

/* ── Reading ─────────────────────────────────────────────────────────────────────────────── */

export function surfacesOf(design: EditionDesign): DesignSurface[] {
  return design.sections.flatMap((s) => s.surfaces);
}

export function blocksOf(design: EditionDesign): DesignBlock[] {
  return surfacesOf(design).flatMap((s) => s.blocks);
}

export function elementsOf(design: EditionDesign): DesignElement[] {
  return blocksOf(design).flatMap((b) => b.elements);
}

/** Where a block sits, for the messages and findings that have to say where something is. */
export type BlockAddress = { sectionId: string; surfaceId: string; blockId: string; sectionIndex: number; surfaceIndex: number; blockIndex: number };

export function addressOf(design: EditionDesign, blockId: string): BlockAddress | null {
  for (const [sectionIndex, sec] of design.sections.entries()) {
    for (const [surfaceIndex, surf] of sec.surfaces.entries()) {
      const blockIndex = surf.blocks.findIndex((b) => b.id === blockId);
      if (blockIndex >= 0) return { sectionId: sec.id, surfaceId: surf.id, blockId, sectionIndex, surfaceIndex, blockIndex };
    }
  }
  return null;
}

export function findBlock(design: EditionDesign, blockId: string): DesignBlock | null {
  return blocksOf(design).find((b) => b.id === blockId) ?? null;
}

export function findElement(design: EditionDesign, elementId: string): { block: DesignBlock; element: DesignElement } | null {
  for (const b of blocksOf(design)) {
    const found = b.elements.find((e) => e.id === elementId);
    if (found) return { block: b, element: found };
  }
  return null;
}

/** Every id in the design, which is what the uniqueness guard and the selection model both need. */
export function idsOf(design: EditionDesign): string[] {
  const ids: string[] = [];
  for (const sec of design.sections) {
    ids.push(sec.id);
    for (const surf of sec.surfaces) {
      ids.push(surf.id);
      for (const b of surf.blocks) {
        ids.push(b.id);
        for (const el of b.elements) ids.push(el.id);
      }
    }
  }
  return ids;
}

/**
 * What one medium actually gets, with overrides applied.
 *
 * Renderers call this rather than reading the block directly, so an override cannot be honoured by
 * the web renderer and forgotten by email.
 */
export function blockFor(block: DesignBlock, medium: (typeof OUTPUT_MEDIA)[number]): DesignBlock | null {
  const override = block.overrides[medium];
  if (override?.omit) return null;
  // Applied whether or not this medium has an override: an element that says "not in email" meant
  // it, and honouring that only for blocks that happen to carry an override is the kind of quiet
  // inconsistency that puts a page number in an inbox.
  const kept = block.elements.filter((el) => !el.omitIn.includes(medium));
  if (!override) return kept.length === block.elements.length ? block : { ...block, elements: kept };
  const composition = override.composition && isComposition(block.role, override.composition) ? override.composition : block.composition;
  const elements = override.content
    ? kept.map((el) => (override.content![el.id] ? { ...el, content: override.content![el.id] } : el))
    : kept;
  return {
    ...block,
    composition,
    style: { ...block.style, ...(override.style ?? {}) },
    constraints: { ...block.constraints, ...(override.constraints ?? {}) },
    elements,
  };
}

/* ── Writing, immutably ──────────────────────────────────────────────────────────────────── */

/**
 * One block changed, everything else identical, and a new revision number.
 *
 * Every design edit goes through here or its siblings. Mutating a design in place would make
 * "compare before and after" a comparison of one object with itself, and §39's history would be a
 * list of identical entries.
 */
export function withBlock(design: EditionDesign, blockId: string, patch: (block: DesignBlock) => DesignBlock): EditionDesign {
  let touched = false;
  const sections = design.sections.map((sec) => ({
    ...sec,
    surfaces: sec.surfaces.map((surf) => ({
      ...surf,
      blocks: surf.blocks.map((b) => {
        if (b.id !== blockId) return b;
        touched = true;
        return patch(b);
      }),
    })),
  }));
  if (!touched) return design;
  return { ...design, sections, revision: design.revision + 1 };
}

export function withElement(design: EditionDesign, elementId: string, patch: (element: DesignElement) => DesignElement): EditionDesign {
  let touched = false;
  const sections = design.sections.map((sec) => ({
    ...sec,
    surfaces: sec.surfaces.map((surf) => ({
      ...surf,
      blocks: surf.blocks.map((b) => {
        if (!b.elements.some((el) => el.id === elementId)) return b;
        touched = true;
        return { ...b, elements: b.elements.map((el) => (el.id === elementId ? patch(el) : el)) };
      }),
    })),
  }));
  if (!touched) return design;
  return { ...design, sections, revision: design.revision + 1 };
}

export function withSurface(design: EditionDesign, surfaceId: string, patch: (surface: DesignSurface) => DesignSurface): EditionDesign {
  let touched = false;
  const sections = design.sections.map((sec) => ({
    ...sec,
    surfaces: sec.surfaces.map((surf) => {
      if (surf.id !== surfaceId) return surf;
      touched = true;
      return patch(surf);
    }),
  }));
  if (!touched) return design;
  return { ...design, sections, revision: design.revision + 1 };
}

/** Add a section, or replace the one with the same id. */
export function withSection(design: EditionDesign, next: DesignSection): EditionDesign {
  const exists = design.sections.some((s) => s.id === next.id);
  const sections = exists ? design.sections.map((s) => (s.id === next.id ? next : s)) : [...design.sections, next];
  return { ...design, sections, revision: design.revision + 1 };
}

/**
 * A block removed — except a locked one, which stays.
 *
 * Refusing here rather than at the call site is deliberate: a lock that only some callers honour is
 * not a lock, and the redesign paths are exactly the ones that would forget.
 */
export function withoutBlock(design: EditionDesign, blockId: string): EditionDesign {
  const target = findBlock(design, blockId);
  if (!target || target.locked) return design;
  const sections = design.sections.map((sec) => ({
    ...sec,
    surfaces: sec.surfaces.map((surf) => ({ ...surf, blocks: surf.blocks.filter((b) => b.id !== blockId) })),
  }));
  return { ...design, sections, revision: design.revision + 1 };
}

/** Whether a redesign may touch this block at all, or only some of it. */
export function mayChange(block: DesignBlock, aspect: DesignBlock["lockedAspects"][number]): boolean {
  if (block.locked && block.lockedAspects.length === 0) return false;
  return !block.lockedAspects.includes(aspect);
}
