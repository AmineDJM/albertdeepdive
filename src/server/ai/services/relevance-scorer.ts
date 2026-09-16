import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const SCORE_DIMENSIONS = ["schoolRelevance", "studentRelevance", "uniqueness", "campusImportance", "timeliness", "editorialInterest", "visualRichness", "institutionalImportance", "businessDataRelevance"] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const relevanceSchema = z.object({
  schoolRelevance: z.number(),
  studentRelevance: z.number(),
  uniqueness: z.number(),
  campusImportance: z.number(),
  timeliness: z.number(),
  editorialInterest: z.number(),
  visualRichness: z.number(),
  institutionalImportance: z.number(),
  businessDataRelevance: z.number(),
  rationale: z.string(),
});
export type RelevanceOutput = z.infer<typeof relevanceSchema>;

export type RelevanceInput = { title: string; storyType: string; campuses: string[]; campusScope?: string; summary: string; sourceCount: number; mediaCount: number; quoteCount: number; wordCount?: number };

export function scoreTotal(scores: Record<string, number>): number {
  const values = SCORE_DIMENSIONS.map((d) => scores[d]).filter((v) => typeof v === "number");
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Scores a story candidate (0–100 per dimension). */
export async function scoreRelevance(input: RelevanceInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "relevance_scorer",
    schemaName: "relevance_scores",
    schema: relevanceSchema,
    input: { title: input.title, storyType: input.storyType, campuses: input.campuses, campusScope: input.campusScope ?? (input.campuses.length ? (input.campuses.length > 1 ? "MULTI" : "SINGLE") : "SCHOOL_WIDE"), summary: input.summary, sourceCount: input.sourceCount, mediaCount: input.mediaCount, quoteCount: input.quoteCount, wordCount: input.wordCount ?? 0 },
    ctx,
  });
}
