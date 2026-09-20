import { findBlock, mayChange, withBlock, withoutBlock, type DesignBlock, type EditionDesign } from "./model";
import { isComposition, PICTURE_ROLES, type BlockRole } from "./roles";
import type { DesignFinding, Remedy } from "./critic";

/**
 * Acting on a critique.
 *
 * The half of §80 that matters: an art director who watches the result and then *changes it*. Every
 * remedy here is a change the engine knows how to make on its own — a different composition, a
 * different weight, a picture removed, a crop replaced — and every one is refused when the design
 * says it may not (§68's locks), because a refinement pass that quietly overrides a lock is worse
 * than one that does nothing.
 *
 * Two rules keep a round reviewable. One change per block, so two findings never fight over the
 * same thing; and a cap on the round, so "what changed" is a list a person can read rather than a
 * new edition.
 */

export type AppliedChange = { findingId: string; blockId: string | null; remedy: Remedy; what: string };
export type SkippedChange = { findingId: string; why: string };

export type ReviseResult = { design: EditionDesign; applied: AppliedChange[]; skipped: SkippedChange[] };

export type ReviseOptions = {
  /** The most changes one round may make. A pass that rewrites everything is not a revision. */
  limit?: number;
};

export function applyRemedies(design: EditionDesign, findings: readonly DesignFinding[], options: ReviseOptions = {}): ReviseResult {
  const limit = options.limit ?? 12;
  const applied: AppliedChange[] = [];
  const skipped: SkippedChange[] = [];
  const touched = new Set<string>();
  let next = design;

  for (const item of findings) {
    if (applied.length >= limit) {
      skipped.push({ findingId: item.id, why: "left for the next round; this one had made enough changes" });
      continue;
    }
    if (item.remedy.kind === "none") {
      skipped.push({ findingId: item.id, why: "there is no change the engine can make on its own" });
      continue;
    }
    const blockId = "blockId" in item.remedy ? item.remedy.blockId : null;
    if (blockId && touched.has(blockId)) {
      skipped.push({ findingId: item.id, why: "something else already changed this block in this round" });
      continue;
    }
    const outcome = apply(next, item.remedy);
    if (!outcome) {
      skipped.push({ findingId: item.id, why: blockId && findBlock(next, blockId)?.locked ? "the block is locked" : "the change no longer applies" });
      continue;
    }
    next = outcome.design;
    if (blockId) touched.add(blockId);
    applied.push({ findingId: item.id, blockId, remedy: item.remedy, what: outcome.what });
  }
  return { design: next, applied, skipped };
}

function apply(design: EditionDesign, remedy: Remedy): { design: EditionDesign; what: string } | null {
  switch (remedy.kind) {
    case "composition": {
      const block = findBlock(design, remedy.blockId);
      if (!block || !mayChange(block, "composition")) return null;
      if (!isComposition(block.role as BlockRole, remedy.to) || block.composition === remedy.to) return null;
      const was = block.composition;
      return {
        design: withBlock(design, block.id, (current) => ({
          ...current,
          composition: remedy.to,
          // What it was becomes an alternative: "change layout" should offer the way it looked
          // before somebody decided it was wrong.
          alternatives: [was, ...current.alternatives.filter((candidate) => candidate !== remedy.to)].slice(0, 3),
          rationale: `set as ${remedy.to.replace(/-/g, " ")} after the issue was looked at`,
        })),
        what: `${block.role} redrawn as ${remedy.to.replace(/-/g, " ")} instead of ${was.replace(/-/g, " ")}`,
      };
    }

    case "importance": {
      const block = findBlock(design, remedy.blockId);
      if (!block || !mayChange(block, "position") || block.importance === remedy.to) return null;
      const was = block.importance;
      return {
        design: withBlock(design, block.id, (current) => ({ ...current, importance: remedy.to })),
        what: `${block.role} set as ${remedy.to.toLowerCase()} rather than ${was.toLowerCase()}`,
      };
    }

    case "drop": {
      const block = findBlock(design, remedy.blockId);
      if (!block || block.locked) return null;
      const after = withoutBlock(design, block.id);
      if (after === design) return null;
      return { design: after, what: `the empty ${block.role} was taken out` };
    }

    case "crop": {
      const block = findBlock(design, remedy.blockId);
      if (!block || !mayChange(block, "image")) return null;
      const picture = block.elements.find((element) => element.content.kind === "media");
      if (!picture || picture.content.kind !== "media" || picture.content.cropId === remedy.shape) return null;
      return {
        design: withBlock(design, block.id, (current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === picture.id && element.content.kind === "media" ? { ...element, content: { ...element.content, cropId: remedy.shape } } : element,
          ),
        })),
        what: `the photograph in the ${block.role} was cut ${remedy.shape}`,
      };
    }

    case "picture": {
      const block = findBlock(design, remedy.blockId);
      if (!block || !mayChange(block, "image")) return null;
      const picture = block.elements.find((element) => element.content.kind === "media");
      if (!picture) return null;

      if (remedy.mediaId === null) {
        // Taking the photograph out of a block whose whole point was the photograph leaves an
        // empty frame, so the block goes with it.
        if (PICTURE_ROLES.includes(block.role)) {
          const after = withoutBlock(design, block.id);
          return after === design ? null : { design: after, what: `the ${block.role} was taken out: its photograph was already used in this issue` };
        }
        return {
          design: withBlock(design, block.id, (current) => ({ ...current, elements: current.elements.filter((element) => element.id !== picture.id && !isCaptionOf(element, current)) })),
          what: `the repeated photograph was taken off the ${block.role}`,
        };
      }

      if (picture.content.kind === "media" && picture.content.mediaId === remedy.mediaId) return null;
      return {
        design: withBlock(design, block.id, (current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === picture.id && element.content.kind === "media" ? { ...element, content: { ...element.content, mediaId: remedy.mediaId! } } : element,
          ),
        })),
        what: `a different photograph was put on the ${block.role}`,
      };
    }

    case "none":
      return null;
  }
}

/** A caption with no picture above it is a caption about nothing. */
function isCaptionOf(element: DesignBlock["elements"][number], block: DesignBlock): boolean {
  return (element.role === "caption" || element.role === "credit") && block.elements.some((candidate) => candidate.content.kind === "media");
}

/** What a round did, in the words the console and the conversation both use. */
export function describeChanges(applied: readonly AppliedChange[]): string {
  if (!applied.length) return "Nothing was changed.";
  return applied.map((change) => change.what).join("; ");
}
