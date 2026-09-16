import { z } from "zod";
import type { ArticleBlock } from "@/lib/publication/document";
import { aiBlockSchema, formatBlocksForPrompt, toAiBlocks } from "./blocks";
import { runService, type AiServiceContext } from "./common";

export const toneSchema = z.object({ blocks: z.array(aiBlockSchema), changes: z.array(z.string()) });
export type ToneOutput = z.infer<typeof toneSchema>;

/** Aligns an article with the paper's voice (capitalised crossheads, British spelling) without changing meaning. */
export async function harmonizeTone(input: { blocks: ArticleBlock[] }, ctx: AiServiceContext = {}) {
  const blocks = toAiBlocks(input.blocks);
  return runService({ service: "tone_harmonizer", schemaName: "tone_harmonized", schema: toneSchema, input: { blocks: formatBlocksForPrompt(blocks), blockList: blocks }, ctx, maxOutputTokens: 4000 });
}
