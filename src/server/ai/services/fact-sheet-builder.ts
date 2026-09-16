import { z } from "zod";
import { factCategorySchema, factConfidenceSchema, runService, type AiServiceContext } from "./common";

export const factSheetSchema = z.object({
  facts: z.array(
    z.object({
      statement: z.string(),
      category: factCategorySchema,
      sourceSubmissionIds: z.array(z.string()),
      excerpt: z.string().nullable(),
      confidence: factConfidenceSchema,
    }),
  ),
  quotes: z.array(z.object({ text: z.string(), speakerName: z.string().nullable(), speakerRole: z.string().nullable(), sourceSubmissionId: z.string() })),
});
export type FactSheetOutput = z.infer<typeof factSheetSchema>;
export type FactSheetFact = FactSheetOutput["facts"][number];
export type FactSheetQuote = FactSheetOutput["quotes"][number];

export type FactSheetSubmission = { id: string; title: string; text: string; storyType: string; contributor?: string | null; quotes?: string | null };

function formatSubmissions(subs: FactSheetSubmission[]) {
  return subs.map((s) => `— Submission ${s.id} (${s.storyType}${s.contributor ? `, by ${s.contributor}` : ""})\nTitle: ${s.title}\n${s.text}${s.quotes ? `\nQuotes given by the contributor: ${s.quotes}` : ""}`).join("\n\n");
}

/** Extracts atomic, sourced facts and verbatim quotes from a cluster's submissions. */
export async function buildFactSheet(input: { submissions: FactSheetSubmission[] }, ctx: AiServiceContext = {}) {
  return runService({
    service: "fact_sheet",
    schemaName: "fact_sheet",
    schema: factSheetSchema,
    input: { submissions: formatSubmissions(input.submissions), submissionList: input.submissions },
    ctx,
    maxOutputTokens: 4000,
  });
}
