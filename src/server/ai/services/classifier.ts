import { z } from "zod";
import { runService, storyTypeSchema, STORY_TYPE_VALUES, type AiServiceContext } from "./common";

export const classifierSchema = z.object({
  storyType: storyTypeSchema,
  sectionSlug: z.string(),
  tags: z.array(z.string()),
  language: z.string(),
  confidence: z.number(),
  reason: z.string(),
});
export type ClassifierOutput = z.infer<typeof classifierSchema>;

export type ClassifierInput = {
  text: string;
  declaredType: string;
  sectionSlugs: string[];
  storyTypes?: string[];
};

/** Assigns a story type, a section slug and tags to a submission. */
export async function classifySubmission(input: ClassifierInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "classifier",
    schemaName: "classification",
    schema: classifierSchema,
    input: {
      storyTypes: input.storyTypes ?? STORY_TYPE_VALUES,
      sectionSlugs: input.sectionSlugs,
      declaredType: input.declaredType,
      text: input.text,
    },
    ctx,
  });
}
