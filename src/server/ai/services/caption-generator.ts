import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const captionSchema = z.object({ caption: z.string(), credit: z.string().nullable() });
export type CaptionOutput = z.infer<typeof captionSchema>;

export type CaptionInput = { storyTitle: string; contributorCaption?: string | null; photographer?: string | null; description?: string | null };

/** Writes a one-sentence caption and a credit line from what is known about the photo. */
export async function generateCaption(input: CaptionInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "caption_generator",
    schemaName: "caption",
    schema: captionSchema,
    input: { storyTitle: input.storyTitle, contributorCaption: input.contributorCaption ?? "", photographer: input.photographer ?? "", description: input.description ?? "" },
    ctx,
  });
}
