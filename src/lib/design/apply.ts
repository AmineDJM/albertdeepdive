import { addressOf, findBlock, mayChange, withBlock, withSurface, withoutBlock, type DesignBlock, type EditionDesign } from "./model";
import { isComposition, type BlockRole } from "./roles";
import { recomposeBlock } from "./compose";
import type { EditionSignals } from "./signals";
import type { ResolvedDirection } from "./identity";
import type { CropShape } from "./crop";
import { summarise, type DesignOperation } from "./operations";

/**
 * Carrying out what was asked, or saying why not.
 *
 * Every operation is checked against the design it is about to change: a block that is not there,
 * a composition its role cannot be drawn in, a change to something the person has held — each of
 * those is refused *in the person's words*, because "I cannot do that because you locked it" is an
 * answer and a silent no is not.
 *
 * Nothing here talks to a model or to a database. It is the same function every time, which is what
 * makes a conversation about a design reproducible: the same sentence understood the same way gives
 * the same design.
 */

export type ApplyContext = {
  signals: EditionSignals;
  direction: ResolvedDirection;
};

export type OperationOutcome = { operation: DesignOperation; done: boolean; what: string };

export type ApplyResult = { design: EditionDesign; outcomes: OperationOutcome[] };

export function applyOperations(design: EditionDesign, operations: readonly DesignOperation[], ctx: ApplyContext): ApplyResult {
  let next = design;
  const outcomes: OperationOutcome[] = [];
  for (const operation of operations) {
    const outcome = applyOne(next, operation, ctx);
    next = outcome.design;
    outcomes.push({ operation, done: outcome.done, what: outcome.what });
  }
  return { design: next, outcomes };
}

function applyOne(design: EditionDesign, operation: DesignOperation, ctx: ApplyContext): { design: EditionDesign; done: boolean; what: string } {
  const refuse = (why: string) => ({ design, done: false, what: why });
  const blockFor = (id: string): DesignBlock | null => findBlock(design, id);

  switch (operation.kind) {
    case "set_composition": {
      const block = blockFor(operation.blockId);
      if (!block) return refuse("that block is not in this design");
      if (!mayChange(block, "composition")) return refuse(`the ${block.role} is held as it is`);
      if (!isComposition(block.role as BlockRole, operation.composition)) return refuse(`a ${block.role} cannot be drawn as “${operation.composition}”`);
      if (block.composition === operation.composition) return refuse(`the ${block.role} is already drawn that way`);
      return {
        design: withBlock(design, block.id, (current) =>
          recomposeBlock(current, { signals: ctx.signals, direction: ctx.direction, sectionId: addressOf(design, current.id)?.sectionId ?? null, force: operation.composition }),
        ),
        done: true,
        what: summarise(operation, () => block.role),
      };
    }

    case "set_importance": {
      const block = blockFor(operation.blockId);
      if (!block) return refuse("that block is not in this design");
      if (!mayChange(block, "position")) return refuse(`the ${block.role} is held where it is`);
      if (block.importance === operation.importance) return refuse(`the ${block.role} is already ${operation.importance.toLowerCase()}`);
      return { design: withBlock(design, block.id, (current) => ({ ...current, importance: operation.importance })), done: true, what: summarise(operation, () => block.role) };
    }

    case "set_picture": {
      const block = blockFor(operation.blockId);
      if (!block) return refuse("that block is not in this design");
      if (!mayChange(block, "image")) return refuse(`the ${block.role}'s photograph is held`);
      const picture = block.elements.find((element) => element.content.kind === "media");
      if (!picture) return refuse(`the ${block.role} has no photograph to change`);
      if (operation.mediaId === null) {
        return {
          design: withBlock(design, block.id, (current) => ({ ...current, elements: current.elements.filter((element) => element.id !== picture.id) })),
          done: true,
          what: summarise(operation, () => block.role),
        };
      }
      return {
        design: withBlock(design, block.id, (current) => ({
          ...current,
          elements: current.elements.map((element) => (element.id === picture.id && element.content.kind === "media" ? { ...element, content: { ...element.content, mediaId: operation.mediaId! } } : element)),
        })),
        done: true,
        what: summarise(operation, () => block.role),
      };
    }

    case "set_crop": {
      const block = blockFor(operation.blockId);
      if (!block) return refuse("that block is not in this design");
      if (!mayChange(block, "image")) return refuse(`the ${block.role}'s photograph is held`);
      const picture = block.elements.find((element) => element.content.kind === "media");
      if (!picture || picture.content.kind !== "media") return refuse(`the ${block.role} has no photograph to cut`);
      return {
        design: withBlock(design, block.id, (current) => ({
          ...current,
          elements: current.elements.map((element) => (element.id === picture.id && element.content.kind === "media" ? { ...element, content: { ...element.content, cropId: operation.shape as CropShape } } : element)),
        })),
        done: true,
        what: summarise(operation, () => block.role),
      };
    }

    case "move_block": {
      const block = blockFor(operation.blockId);
      const at = block ? addressOf(design, block.id) : null;
      if (!block || !at) return refuse("that block is not in this design");
      if (!mayChange(block, "position")) return refuse(`the ${block.role} is held where it is`);
      const step = operation.direction === "up" ? -1 : 1;
      const target = at.blockIndex + step;
      const surface = design.sections[at.sectionIndex].surfaces[at.surfaceIndex];
      if (target < 0 || target >= surface.blocks.length) return refuse(`the ${block.role} is already ${operation.direction === "up" ? "first" : "last"} on its surface`);
      const neighbour = surface.blocks[target];
      if (!mayChange(neighbour, "position")) return refuse(`the ${neighbour.role} beside it is held where it is`);
      const blocks = [...surface.blocks];
      blocks[at.blockIndex] = neighbour;
      blocks[target] = block;
      return { design: withSurface(design, surface.id, (current) => ({ ...current, blocks })), done: true, what: summarise(operation, () => block.role) };
    }

    case "remove_block": {
      const block = blockFor(operation.blockId);
      if (!block) return refuse("that block is not in this design");
      if (block.locked) return refuse(`the ${block.role} is held as it is`);
      const after = withoutBlock(design, block.id);
      if (after === design) return refuse(`the ${block.role} could not be taken out`);
      return { design: after, done: true, what: summarise(operation, () => block.role) };
    }

    case "lock": {
      const block = blockFor(operation.blockId);
      if (!block) return refuse("that block is not in this design");
      return {
        design: withBlock(design, block.id, (current) => ({ ...current, locked: operation.aspects.length === 0, lockedAspects: operation.aspects })),
        done: true,
        what: summarise(operation, () => block.role),
      };
    }

    case "unlock": {
      const block = blockFor(operation.blockId);
      if (!block) return refuse("that block is not in this design");
      if (!block.locked && !block.lockedAspects.length) return refuse(`the ${block.role} was not held`);
      return { design: withBlock(design, block.id, (current) => ({ ...current, locked: false, lockedAspects: [] })), done: true, what: summarise(operation, () => block.role) };
    }

    case "copy_style": {
      const from = blockFor(operation.fromBlockId);
      const to = blockFor(operation.toBlockId);
      if (!from || !to) return refuse("one of those blocks is not in this design");
      if (!mayChange(to, "composition") || !mayChange(to, "type")) return refuse(`the ${to.role} is held as it is`);
      if (from.role !== to.role && !isComposition(to.role as BlockRole, from.composition)) {
        // The style travels only where it can be drawn. A cover's composition on a brief is not a
        // style, it is a broken page.
        return { design: withBlock(design, to.id, (current) => ({ ...current, style: { ...from.style } })), done: true, what: `the ${to.role} took the ${from.role}'s styling, but not its composition` };
      }
      return {
        design: withBlock(design, to.id, (current) => ({ ...current, composition: from.composition, style: { ...from.style } })),
        done: true,
        what: summarise(operation, (id) => (id === from.id ? from.role : to.role)),
      };
    }

    case "redesign": {
      if (operation.scope === "edition") return refuse("the whole issue is designed again by the engine, not here");
      const targets = scopeOf(design, operation.scope, operation.targetId);
      if (!targets.length) return refuse("there is nothing there to design again");
      let next = design;
      let changed = 0;
      const held: string[] = [];
      for (const block of targets) {
        if (!mayChange(block, "composition")) {
          held.push(block.role);
          continue;
        }
        const sectionId = addressOf(design, block.id)?.sectionId ?? null;
        const recomposed = recomposeBlock(block, { signals: ctx.signals, direction: ctx.direction, sectionId });
        if (recomposed === block || recomposed.composition === block.composition) continue;
        next = withBlock(next, block.id, () => recomposed);
        changed += 1;
      }
      if (!changed) return refuse(held.length ? `everything there is held: ${[...new Set(held)].join(", ")}` : "there was no other way to draw any of it");
      return { design: next, done: true, what: `${changed} block${changed === 1 ? "" : "s"} designed again${held.length ? `, ${held.length} left as held` : ""}` };
    }

    case "restore_revision":
      return refuse("a revision is put back by the design's history, not here");

    default:
      // The direction dials are the issue's, not a block's: they are saved as art direction and the
      // issue is composed again from them.
      return refuse("that changes the issue's direction, which is applied when the issue is composed again");
  }
}

function scopeOf(design: EditionDesign, scope: "block" | "surface" | "section", targetId: string | null): DesignBlock[] {
  if (scope === "block") {
    const block = targetId ? findBlock(design, targetId) : null;
    return block ? [block] : [];
  }
  if (scope === "surface") {
    for (const section of design.sections) {
      const surface = section.surfaces.find((candidate) => candidate.id === targetId);
      if (surface) return surface.blocks;
    }
    return [];
  }
  const section = design.sections.find((candidate) => candidate.id === targetId || candidate.sectionId === targetId);
  return section ? section.surfaces.flatMap((surface) => surface.blocks) : [];
}
