import { z } from "zod";
import { runService, warningSeveritySchema, type AiServiceContext } from "./common";

export const editionQaSchema = z.object({
  issues: z.array(z.object({ code: z.string(), severity: warningSeveritySchema, message: z.string(), articleId: z.string().nullable() })),
  assessment: z.string(),
});
export type EditionQaOutput = z.infer<typeof editionQaSchema>;

export type QaArticle = { id: string; headline: string; standfirst: string | null; section: string; text: string; captionsMissing: number; imageCount: number };

/** Reads the whole edition and flags editorial problems before publication. */
export async function runEditionQa(input: { label: string; campuses: string[]; articles: QaArticle[] }, ctx: AiServiceContext = {}) {
  return runService({
    service: "edition_qa",
    schemaName: "edition_qa",
    schema: editionQaSchema,
    input: {
      label: input.label,
      campuses: input.campuses,
      contents: input.articles.map((a) => `— Article ${a.id} [${a.section}]\nHeadline: ${a.headline}\nStandfirst: ${a.standfirst ?? "—"}\nImages: ${a.imageCount} (${a.captionsMissing} without caption)\n${a.text}`).join("\n\n") || "—",
      articleList: input.articles,
    },
    ctx,
    maxOutputTokens: 3000,
  });
}
