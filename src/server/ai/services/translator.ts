import { z } from "zod";
import type { ArticleBlock } from "@/lib/publication/document";
import { aiBlockSchema, formatBlocksForPrompt, toAiBlocks } from "./blocks";
import { runService, type AiServiceContext } from "./common";

export const translationSchema = z.object({ blocks: z.array(aiBlockSchema), notes: z.array(z.string()) });
export type TranslationOutput = z.infer<typeof translationSchema>;

/** Translates article blocks between English and French, preserving names and block ids. */
export async function translateArticle(input: { blocks: ArticleBlock[]; targetLanguage: "en" | "fr" }, ctx: AiServiceContext = {}) {
  const blocks = toAiBlocks(input.blocks);
  return runService({ service: "translator", schemaName: "translation", schema: translationSchema, input: { targetLanguage: input.targetLanguage, blocks: formatBlocksForPrompt(blocks), blockList: blocks }, ctx, maxOutputTokens: 4000 });
}
