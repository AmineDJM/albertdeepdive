import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const headlinesSchema = z.object({
  headlines: z.array(z.object({ text: z.string(), angle: z.string() })),
});
export type HeadlinesOutput = z.infer<typeof headlinesSchema>;

export type HeadlineInput = {
  storyType: string;
  title: string;
  facts: { id: string; statement: string; category: string | null }[];
  currentHeadline?: string | null;
  count?: number;
  company?: string | null;
  cohort?: string | null;
  standfirst?: string | null;
};

/** Proposes `count` distinct print headlines (max 70 characters each). */
export async function generateHeadlines(input: HeadlineInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "headline_generator",
    schemaName: "headlines",
    schema: headlinesSchema,
    input: {
      storyType: input.storyType,
      title: input.title,
      facts: input.facts.length ? input.facts.map((f) => `- ${f.statement}${f.category ? ` [${f.category}]` : ""}`).join("\n") : "—",
      factList: input.facts,
      currentHeadline: input.currentHeadline ?? "",
      count: input.count ?? 5,
      company: input.company ?? "",
      cohort: input.cohort ?? "",
      standfirst: input.standfirst ?? "",
    },
    ctx,
  });
}
