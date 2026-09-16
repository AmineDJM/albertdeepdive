/**
 * Article blocks as exchanged with models: every field present (nullable instead of optional) so the
 * JSON schema can be strict, plus converters to and from the canonical ArticleBlock type.
 */
import { z } from "zod";
import type { ArticleBlock } from "@/lib/publication/document";
import { newBlockId } from "@/lib/publication/document";

export const aiBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.enum(["paragraph"]), text: z.string() }),
  z.object({ id: z.string(), type: z.enum(["crosshead"]), text: z.string() }),
  z.object({ id: z.string(), type: z.enum(["pullquote"]), text: z.string(), attribution: z.string().nullable() }),
  z.object({ id: z.string(), type: z.enum(["list"]), items: z.array(z.string()), ordered: z.boolean() }),
  z.object({ id: z.string(), type: z.enum(["image"]), assetId: z.string(), caption: z.string().nullable(), credit: z.string().nullable() }),
  z.object({ id: z.string(), type: z.enum(["box"]), title: z.string().nullable(), items: z.array(z.string()), text: z.string().nullable() }),
  z.object({ id: z.string(), type: z.enum(["qa"]), question: z.string(), answer: z.string() }),
  z.object({ id: z.string(), type: z.enum(["testimony"]), text: z.string(), speaker: z.string().nullable() }),
  z.object({ id: z.string(), type: z.enum(["divider"]) }),
]);
export type AiBlock = z.infer<typeof aiBlockSchema>;

export function toAiBlock(block: ArticleBlock): AiBlock {
  switch (block.type) {
    case "paragraph":
      return { id: block.id, type: "paragraph", text: block.text };
    case "crosshead":
      return { id: block.id, type: "crosshead", text: block.text };
    case "pullquote":
      return { id: block.id, type: "pullquote", text: block.text, attribution: block.attribution ?? null };
    case "list":
      return { id: block.id, type: "list", items: block.items, ordered: block.ordered ?? false };
    case "image":
      return { id: block.id, type: "image", assetId: block.assetId, caption: block.caption ?? null, credit: block.credit ?? null };
    case "box":
      return { id: block.id, type: "box", title: block.title ?? null, items: block.items ?? [], text: block.text ?? null };
    case "qa":
      return { id: block.id, type: "qa", question: block.question, answer: block.answer };
    case "testimony":
      return { id: block.id, type: "testimony", text: block.text, speaker: block.speaker ?? null };
    case "divider":
      return { id: block.id, type: "divider" };
  }
}

export function toAiBlocks(blocks: ArticleBlock[]): AiBlock[] {
  return blocks.map(toAiBlock);
}

/**
 * Converts model blocks back to canonical blocks. Provenance-bearing fields (`sources`, image `size`)
 * are restored from the original block with the same id; new blocks get fresh ids.
 */
export function fromAiBlocks(blocks: AiBlock[], original: ArticleBlock[] = []): ArticleBlock[] {
  const byId = new Map(original.map((b) => [b.id, b]));
  return blocks.map((b) => {
    const prev = byId.get(b.id);
    const id = b.id && (!prev || prev.type === b.type) ? b.id : newBlockId();
    const sources = prev && "sources" in prev ? prev.sources : undefined;
    switch (b.type) {
      case "paragraph":
        return { id, type: "paragraph", text: b.text, ...(sources ? { sources } : {}) };
      case "crosshead":
        return { id, type: "crosshead", text: b.text };
      case "pullquote":
        return { id, type: "pullquote", text: b.text, ...(b.attribution ? { attribution: b.attribution } : {}), ...(sources ? { sources } : {}) };
      case "list":
        return { id, type: "list", items: b.items, ordered: b.ordered, ...(sources ? { sources } : {}) };
      case "image":
        return { id, type: "image", assetId: b.assetId, ...(b.caption ? { caption: b.caption } : {}), ...(b.credit ? { credit: b.credit } : {}), ...(prev?.type === "image" && prev.size ? { size: prev.size } : {}) };
      case "box":
        return { id, type: "box", ...(b.title ? { title: b.title } : {}), items: b.items, ...(b.text ? { text: b.text } : {}), ...(sources ? { sources } : {}) };
      case "qa":
        return { id, type: "qa", question: b.question, answer: b.answer, ...(sources ? { sources } : {}) };
      case "testimony":
        return { id, type: "testimony", text: b.text, ...(b.speaker ? { speaker: b.speaker } : {}), ...(sources ? { sources } : {}) };
      case "divider":
        return { id, type: "divider" };
    }
  });
}

export function aiBlockText(b: AiBlock): string {
  switch (b.type) {
    case "paragraph":
    case "crosshead":
    case "pullquote":
    case "testimony":
      return b.text;
    case "list":
      return b.items.join(" ");
    case "box":
      return [b.title, b.text, ...b.items].filter(Boolean).join(" ");
    case "qa":
      return `${b.question} ${b.answer}`;
    case "image":
      return b.caption ?? "";
    case "divider":
      return "";
  }
}

/** Compact, readable rendering of blocks for prompts. */
export function formatBlocksForPrompt(blocks: AiBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "paragraph":
          return `[${b.id}] (paragraph) ${b.text}`;
        case "crosshead":
          return `[${b.id}] (crosshead) ${b.text}`;
        case "pullquote":
          return `[${b.id}] (pullquote) “${b.text}”${b.attribution ? ` — ${b.attribution}` : ""}`;
        case "list":
          return `[${b.id}] (list) ${b.items.map((i) => `• ${i}`).join(" ")}`;
        case "image":
          return `[${b.id}] (image ${b.assetId}) ${b.caption ?? ""}`;
        case "box":
          return `[${b.id}] (box${b.title ? `: ${b.title}` : ""}) ${[b.text, ...b.items].filter(Boolean).join(" · ")}`;
        case "qa":
          return `[${b.id}] (qa) ${b.question} — ${b.answer}`;
        case "testimony":
          return `[${b.id}] (testimony${b.speaker ? ` by ${b.speaker}` : ""}) ${b.text}`;
        case "divider":
          return `[${b.id}] (divider)`;
      }
    })
    .join("\n");
}
