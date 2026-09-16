import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const normalizerSchema = z.object({
  normalizedText: z.string(),
  summary: z.string(),
  language: z.string(),
  wordCount: z.number(),
});
export type NormalizerOutput = z.infer<typeof normalizerSchema>;

export type NormalizerInput = {
  storyType: string;
  campus: string;
  title: string;
  description: string;
  peopleInvolved?: string | null;
  organisationsInvolved?: string | null;
  whyItMatters?: string | null;
  quotes?: string | null;
  eventDateText?: string | null;
  extra?: Record<string, unknown> | null;
};

/** Cleans a raw submission into a normalised text and a neutral summary. Adds nothing. */
export async function normalizeSubmission(input: NormalizerInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "normalizer",
    schemaName: "normalized_submission",
    schema: normalizerSchema,
    input: {
      storyType: input.storyType,
      campus: input.campus,
      title: input.title,
      description: input.description,
      peopleInvolved: input.peopleInvolved ?? "",
      organisationsInvolved: input.organisationsInvolved ?? "",
      whyItMatters: input.whyItMatters ?? "",
      quotes: input.quotes ?? "",
      eventDateText: input.eventDateText ?? "",
      extra: input.extra ?? {},
    },
    ctx,
  });
}
