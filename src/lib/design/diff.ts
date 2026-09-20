import { addressOf, blocksOf, surfacesOf, type DesignBlock, type EditionDesign } from "./model";

/**
 * What changed between two designs.
 *
 * §40 asks for a design history a person can read and compare, and §39 for changes that touch only
 * what they are about. Both need the same thing: an exact answer to "what is different", in words
 * rather than in ids.
 *
 * It compares the graph, not the render. Two designs that produce the same pages by different means
 * are different designs, and a revision that changed nothing should say so rather than claim work.
 */

export type DesignChangeKind = "added" | "removed" | "moved" | "composition" | "importance" | "picture" | "crop" | "lock" | "style" | "structure";

export type DesignChange = {
  kind: DesignChangeKind;
  blockId: string | null;
  /** One line, in the words an editor would use. */
  what: string;
};

export function diffDesigns(before: EditionDesign, after: EditionDesign): DesignChange[] {
  const changes: DesignChange[] = [];
  const was = new Map(blocksOf(before).map((block) => [block.id, block]));
  const now = new Map(blocksOf(after).map((block) => [block.id, block]));

  for (const [id, block] of was) {
    if (!now.has(id)) changes.push({ kind: "removed", blockId: id, what: `the ${label(block)} was taken out` });
  }
  for (const [id, block] of now) {
    if (!was.has(id)) changes.push({ kind: "added", blockId: id, what: `a ${label(block)} was added` });
  }

  for (const [id, block] of now) {
    const old = was.get(id);
    if (!old) continue;

    if (old.composition !== block.composition) {
      changes.push({ kind: "composition", blockId: id, what: `the ${label(block)} is drawn as ${block.composition.replace(/-/g, " ")} instead of ${old.composition.replace(/-/g, " ")}` });
    }
    if (old.importance !== block.importance) {
      changes.push({ kind: "importance", blockId: id, what: `the ${label(block)} is set as ${block.importance.toLowerCase()} rather than ${old.importance.toLowerCase()}` });
    }
    const pictureBefore = mediaOf(old);
    const pictureAfter = mediaOf(block);
    if (pictureBefore !== pictureAfter) {
      changes.push({
        kind: "picture",
        blockId: id,
        what: !pictureAfter ? `the ${label(block)} lost its photograph` : !pictureBefore ? `the ${label(block)} was given a photograph` : `the ${label(block)} has a different photograph`,
      });
    } else if (pictureAfter && cropOf(old) !== cropOf(block)) {
      changes.push({ kind: "crop", blockId: id, what: `the ${label(block)}'s photograph is cut ${cropOf(block) ?? "as it comes"}` });
    }
    if (old.locked !== block.locked || old.lockedAspects.join() !== block.lockedAspects.join()) {
      const held = block.locked || block.lockedAspects.length;
      changes.push({ kind: "lock", blockId: id, what: held ? `the ${label(block)} is held${block.lockedAspects.length ? ` (${block.lockedAspects.join(", ")})` : ""}` : `the ${label(block)} is no longer held` });
    }
    if (JSON.stringify(old.style) !== JSON.stringify(block.style)) {
      changes.push({ kind: "style", blockId: id, what: `the ${label(block)} is styled differently` });
    }

    const from = addressOf(before, id);
    const to = addressOf(after, id);
    if (from && to && (from.surfaceIndex !== to.surfaceIndex || from.blockIndex !== to.blockIndex)) {
      changes.push({ kind: "moved", blockId: id, what: `the ${label(block)} moved` });
    }
  }

  const surfacesBefore = surfacesOf(before).length;
  const surfacesAfter = surfacesOf(after).length;
  if (surfacesBefore !== surfacesAfter) {
    changes.push({ kind: "structure", blockId: null, what: `the issue has ${surfacesAfter} surfaces rather than ${surfacesBefore}` });
  }
  if (JSON.stringify(before.grid) !== JSON.stringify(after.grid)) {
    changes.push({ kind: "structure", blockId: null, what: `the grid changed to ${after.grid.columns} columns, ${after.grid.shape.replace(/-/g, " ")}` });
  }
  return changes;
}

function label(block: DesignBlock): string {
  return block.role.replace(/-/g, " ");
}

function mediaOf(block: DesignBlock): string | null {
  const picture = block.elements.find((element) => element.content.kind === "media");
  return picture && picture.content.kind === "media" ? picture.content.mediaId : null;
}

function cropOf(block: DesignBlock): string | null {
  const picture = block.elements.find((element) => element.content.kind === "media");
  return picture && picture.content.kind === "media" ? (picture.content.cropId ?? null) : null;
}

/** The blocks that are not identical between two designs. The proof that a change stayed local. */
export function touched(before: EditionDesign, after: EditionDesign): string[] {
  const was = new Map(blocksOf(before).map((block) => [block.id, JSON.stringify(block)]));
  const now = new Map(blocksOf(after).map((block) => [block.id, JSON.stringify(block)]));
  const ids = new Set([...was.keys(), ...now.keys()]);
  return [...ids].filter((id) => was.get(id) !== now.get(id));
}

export function describeDiff(changes: readonly DesignChange[]): string {
  if (!changes.length) return "Nothing changed.";
  if (changes.length <= 3) return `${capitalise(changes.map((change) => change.what).join(", and "))}.`;
  return `${capitalise(changes.slice(0, 2).map((change) => change.what).join(", "))}, and ${changes.length - 2} other changes.`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
