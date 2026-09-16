import { z } from "zod";
import type { ArticleBlock } from "@/lib/publication/document";
import { formatBlocksForPrompt, toAiBlocks } from "./blocks";
import { runService, warningSeveritySchema, type AiServiceContext } from "./common";

export const consistencyIssueTypeSchema = z.enum(["UNSUPPORTED", "CONTRADICTION", "NAME_MISMATCH", "NUMBER_MISMATCH", "QUOTE_ALTERED"]);

export const consistencySchema = z.object({
  issues: z.array(z.object({ blockId: z.string(), excerpt: z.string(), type: consistencyIssueTypeSchema, explanation: z.string(), severity: warningSeveritySchema })),
  verdict: z.string(),
});
export type ConsistencyOutput = z.infer<typeof consistencySchema>;
export type ConsistencyIssue = ConsistencyOutput["issues"][number];

export type ConsistencyInput = {
  blocks: ArticleBlock[];
  facts: { id: string; statement: string; confidence?: string; status?: string }[];
  quotes: { id: string; text: string; speaker: string | null }[];
};

/** Compares an article with its fact sheet and reports unsupported or contradicting statements. */
export async function checkConsistency(input: ConsistencyInput, ctx: AiServiceContext = {}) {
  const blocks = toAiBlocks(input.blocks);
  return runService({
    service: "consistency_checker",
    schemaName: "consistency_report",
    schema: consistencySchema,
    input: {
      facts: input.facts.length ? input.facts.map((f) => `${f.id}: ${f.statement}${f.confidence ? ` [${f.confidence}]` : ""}`).join("\n") : "—",
      factList: input.facts,
      quotes: input.quotes.length ? input.quotes.map((q) => `${q.id}: "${q.text}" — ${q.speaker ?? "unknown"}`).join("\n") : "—",
      quoteList: input.quotes,
      blocks: formatBlocksForPrompt(blocks),
      blockList: blocks,
    },
    ctx,
  });
}
