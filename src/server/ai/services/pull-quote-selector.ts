import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const pullQuoteSchema = z.object({
  quoteId: z.string().nullable(),
  text: z.string().nullable(),
  reason: z.string(),
});
export type PullQuoteOutput = z.infer<typeof pullQuoteSchema>;

export type PullQuoteCandidate = { id: string; text: string; speaker: string | null; role?: string | null };

/** Chooses the strongest verbatim quote (trimmed to 140 characters) as a pull quote. */
export async function selectPullQuote(input: { quotes: PullQuoteCandidate[] }, ctx: AiServiceContext = {}) {
  return runService({
    service: "pull_quote_selector",
    schemaName: "pull_quote",
    schema: pullQuoteSchema,
    input: { quotes: input.quotes.length ? input.quotes.map((q) => `${q.id}: "${q.text}" — ${q.speaker ?? "unknown"}${q.role ? ` (${q.role})` : ""}`).join("\n") : "—", quoteList: input.quotes },
    ctx,
  });
}
