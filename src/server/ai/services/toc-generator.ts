import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const tocSchema = z.object({ lines: z.array(z.object({ articleId: z.string(), text: z.string() })) });
export type TocOutput = z.infer<typeof tocSchema>;

export type TocArticle = { id: string; section: string; headline: string; standfirst: string | null };

/** Writes one contents line (max 60 characters) per article. */
export async function generateToc(input: { articles: TocArticle[] }, ctx: AiServiceContext = {}) {
  return runService({
    service: "toc_generator",
    schemaName: "table_of_contents",
    schema: tocSchema,
    input: { articles: input.articles.map((a) => `${a.id} | ${a.section} | ${a.headline} | ${a.standfirst ?? ""}`).join("\n") || "—", articleList: input.articles },
    ctx,
  });
}
