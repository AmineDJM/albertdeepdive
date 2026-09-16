import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const externalNewsSchema = z.object({
  title: z.string(),
  paragraphs: z.array(z.string()),
  whyItMatters: z.string(),
  sourceUrls: z.array(z.string()),
});
export type ExternalNewsOutput = z.infer<typeof externalNewsSchema>;

export type ExternalSource = { url: string; title: string; text: string };

/** Summarises editor-provided external sources for the Business & Data section, keeping the links. */
export async function summarizeExternalNews(input: { sources: ExternalSource[]; notes?: string | null }, ctx: AiServiceContext = {}) {
  return runService({
    service: "external_news_summarizer",
    schemaName: "external_news",
    schema: externalNewsSchema,
    input: { sources: input.sources.map((s) => `— ${s.title}\n${s.url}\n${s.text}`).join("\n\n") || "—", sourceList: input.sources, notes: input.notes ?? "" },
    ctx,
  });
}
