import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

const draftBlockSchema = z.union([
  z.object({ type: z.enum(["paragraph"]), text: z.string(), factIds: z.array(z.string()) }),
  z.object({ type: z.enum(["crosshead"]), text: z.string() }),
  z.object({ type: z.enum(["qa"]), question: z.string(), answer: z.string(), factIds: z.array(z.string()) }),
  z.object({ type: z.enum(["pullquote"]), quoteId: z.string() }),
  z.object({ type: z.enum(["list"]), items: z.array(z.string()), factIds: z.array(z.string()) }),
  z.object({ type: z.enum(["box"]), title: z.string(), items: z.array(z.string()), factIds: z.array(z.string()) }),
  z.object({ type: z.enum(["testimony"]), quoteId: z.string().nullable(), text: z.string().nullable(), speaker: z.string().nullable(), factIds: z.array(z.string()) }),
]);
export type DraftBlock = z.infer<typeof draftBlockSchema>;

export const articleDraftSchema = z.object({
  blocks: z.array(draftBlockSchema),
  unusedFacts: z.array(z.string()),
  cautions: z.array(z.string()),
});
export type ArticleDraftOutput = z.infer<typeof articleDraftSchema>;

export type DraftFact = { id: string; statement: string; category: string | null; confidence: string; status?: string; sourceSubmissionId: string | null };
export type DraftQuote = { id: string; text: string; speaker: string | null; role: string | null; sourceSubmissionId: string | null };
export type DraftSubmission = { id: string; title: string; text: string; storyType: string; contributor?: string | null };

export type ArticleDrafterInput = {
  storyType: string;
  targetLength: string;
  targetWords: number;
  title: string;
  campuses: string[];
  facts: DraftFact[];
  quotes: DraftQuote[];
  submissions: DraftSubmission[];
  editorNotes?: string | null;
  bdd?: Record<string, unknown> | null;
};

/** Writes a structured, fully-cited article draft from the fact sheet, quotes and sources. */
export async function draftArticleBlocks(input: ArticleDrafterInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "article_drafter",
    schemaName: "article_draft",
    schema: articleDraftSchema,
    input: {
      storyType: input.storyType,
      targetLength: input.targetLength,
      targetWords: input.targetWords,
      title: input.title,
      campuses: input.campuses,
      facts: input.facts.length ? input.facts.map((f) => `${f.id}: ${f.statement} [${f.confidence}${f.category ? `, ${f.category}` : ""}]`).join("\n") : "—",
      factList: input.facts,
      quotes: input.quotes.length ? input.quotes.map((q) => `${q.id}: "${q.text}" — ${q.speaker ?? "unknown speaker"}${q.role ? ` (${q.role})` : ""}`).join("\n") : "—",
      quoteList: input.quotes,
      submissions: input.submissions,
      editorNotes: input.editorNotes ?? "",
      bdd: input.bdd ?? {},
    },
    ctx,
    maxOutputTokens: 4000,
  });
}
