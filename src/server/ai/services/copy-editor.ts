import { z } from "zod";
import type { ArticleBlock } from "@/lib/publication/document";
import { aiBlockSchema, formatBlocksForPrompt, toAiBlocks } from "./blocks";
import { runService, type AiServiceContext } from "./common";

export const copyEditSchema = z.object({ blocks: z.array(aiBlockSchema), changes: z.array(z.string()) });
export type CopyEditOutput = z.infer<typeof copyEditSchema>;

export type CopyEditInput = { blocks: ArticleBlock[]; instruction?: string | null; targetWords?: number | null };

/** Copy-edits blocks for clarity and house style while preserving every fact and quote. */
export async function copyEditArticle(input: CopyEditInput, ctx: AiServiceContext = {}) {
  const blocks = toAiBlocks(input.blocks);
  return runService({
    service: "copy_editor",
    schemaName: "copy_edit",
    schema: copyEditSchema,
    input: { instruction: input.instruction ?? "Copy-edit for clarity and house style.", blocks: formatBlocksForPrompt(blocks), blockList: blocks, targetWords: input.targetWords ?? 0 },
    ctx,
    maxOutputTokens: 4000,
  });
}
