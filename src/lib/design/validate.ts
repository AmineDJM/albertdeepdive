import type { EditionDocument } from "@/lib/publication/document";
import { blocksOf, idsOf, surfacesOf, type EditionDesign } from "./model";
import { isComposition, isStoryRole } from "./roles";

/**
 * Whether a design can actually be rendered against the edition it claims to describe.
 *
 * Everything here is a way a design could be internally plausible and still produce a broken page:
 * an element pointing at an article that was deleted, a picture that is not in the edition, a
 * composition no renderer implements, two blocks sharing an id so "make this bigger" changes the
 * wrong one. Each is cheap to check and expensive to discover in a PDF.
 *
 * This runs before rendering, not instead of quality control. It answers "can this be drawn at
 * all"; whether what was drawn is any good is the critic's question, and the critic has to look.
 */

export type DesignIssueCode =
  | "duplicate.id"
  | "ref.article.missing"
  | "ref.block.missing"
  | "ref.media.missing"
  | "ref.section.missing"
  | "ref.fact.missing"
  | "composition.unknown"
  | "measure.inverted"
  | "columns.inverted"
  | "width.inverted"
  | "story.unattached"
  | "surface.empty"
  | "cover.missing"
  | "cover.duplicated";

export type DesignIssue = {
  code: DesignIssueCode;
  severity: "error" | "warning";
  message: string;
  /** The block or element the issue is about, so a finding can be pointed at something. */
  target: string | null;
};

export function validateDesign(design: EditionDesign, doc: EditionDocument): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const articles = new Map(doc.articles.map((a) => [a.id, a]));
  const media = new Set(doc.media.map((m) => m.id));
  const sections = new Set(doc.sections.map((s) => s.id));

  // Ids first: everything downstream — selection, locks, history, findings — assumes they are unique.
  const seen = new Set<string>();
  for (const id of idsOf(design)) {
    if (seen.has(id)) issues.push({ code: "duplicate.id", severity: "error", message: `Two things in the design share the id ${id}`, target: id });
    seen.add(id);
  }

  for (const block of blocksOf(design)) {
    if (!isComposition(block.role, block.composition)) {
      issues.push({ code: "composition.unknown", severity: "error", message: `No renderer draws a ${block.role} as “${block.composition}”`, target: block.id });
    }
    for (const [medium, override] of Object.entries(block.overrides)) {
      if (override?.composition && !isComposition(block.role, override.composition)) {
        issues.push({ code: "composition.unknown", severity: "error", message: `The ${medium} override asks for a ${block.role} drawn as “${override.composition}”, which does not exist`, target: block.id });
      }
    }
    // A story block with no story is a card with nothing in it, which is how blank pages happen.
    if (isStoryRole(block.role) && !block.articleId && !block.storyId && block.elements.length === 0) {
      issues.push({ code: "story.unattached", severity: "error", message: `A ${block.role} block carries no story and no content`, target: block.id });
    }
    checkConstraints(block.id, block.constraints, issues);

    for (const el of block.elements) {
      checkConstraints(el.id, el.constraints, issues);
      const ref = el.content;
      if (ref.kind === "article") {
        const article = articles.get(ref.articleId);
        if (!article) {
          issues.push({ code: "ref.article.missing", severity: "error", message: `An element points at article ${ref.articleId}, which is not in this edition`, target: el.id });
        } else if (ref.part === "body" && ref.blockIds?.length) {
          const known = new Set(article.body.map((b) => b.id));
          for (const id of ref.blockIds) {
            if (!known.has(id)) issues.push({ code: "ref.block.missing", severity: "error", message: `An element carries block ${id}, which is no longer in the article`, target: el.id });
          }
        }
      } else if (ref.kind === "media") {
        if (!media.has(ref.mediaId)) issues.push({ code: "ref.media.missing", severity: "error", message: `A picture in the design (${ref.mediaId}) is not in this edition`, target: el.id });
      } else if (ref.kind === "section") {
        if (!sections.has(ref.sectionId)) issues.push({ code: "ref.section.missing", severity: "error", message: `A section opener points at section ${ref.sectionId}, which does not exist`, target: el.id });
      } else if (ref.kind === "fact") {
        const article = articles.get(ref.articleId);
        const found = article?.facts?.some((f) => f.id === ref.factId);
        if (!found) issues.push({ code: "ref.fact.missing", severity: "warning", message: `A stat points at a fact (${ref.factId}) the article no longer carries`, target: el.id });
      }
    }
  }

  for (const surf of surfacesOf(design)) {
    if (surf.blocks.length === 0) issues.push({ code: "surface.empty", severity: "warning", message: "A surface has nothing on it", target: surf.id });
  }

  // Exactly one cover: none leaves print without a front, two is a design that has changed its mind.
  const covers = blocksOf(design).filter((b) => b.role === "cover");
  if (design.media.includes("print") && covers.length === 0) {
    issues.push({ code: "cover.missing", severity: "warning", message: "Nothing in the design is the cover", target: null });
  }
  if (covers.length > 1) {
    issues.push({ code: "cover.duplicated", severity: "error", message: `The design has ${covers.length} covers`, target: covers[1].id });
  }

  return issues;
}

function checkConstraints(target: string, c: { minMeasure?: number; maxMeasure?: number; minColumns?: number; maxColumns?: number; minWidth?: number; maxWidth?: number }, issues: DesignIssue[]) {
  if (c.minMeasure !== undefined && c.maxMeasure !== undefined && c.minMeasure > c.maxMeasure) {
    issues.push({ code: "measure.inverted", severity: "error", message: `A measure of at least ${c.minMeasure} and at most ${c.maxMeasure} characters cannot be satisfied`, target });
  }
  if (c.minColumns !== undefined && c.maxColumns !== undefined && c.minColumns > c.maxColumns) {
    issues.push({ code: "columns.inverted", severity: "error", message: `At least ${c.minColumns} and at most ${c.maxColumns} columns cannot be satisfied`, target });
  }
  if (c.minWidth !== undefined && c.maxWidth !== undefined && c.minWidth > c.maxWidth) {
    issues.push({ code: "width.inverted", severity: "error", message: "A minimum width larger than the maximum cannot be satisfied", target });
  }
}

/** Whether anything would stop this design being rendered. Warnings do not. */
export function isRenderable(issues: DesignIssue[]): boolean {
  return !issues.some((i) => i.severity === "error");
}
