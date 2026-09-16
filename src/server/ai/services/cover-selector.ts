import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const coverSchema = z.object({
  coverStoryId: z.string().nullable(),
  coverHeadline: z.string(),
  coverStandfirst: z.string(),
  teasers: z.array(z.object({ storyId: z.string(), line: z.string() })),
});
export type CoverOutput = z.infer<typeof coverSchema>;

export type CoverStory = { id: string; headline: string; standfirst: string | null; storyType: string; photos: number; score: number; hasHero: boolean; visualRichness: number };

/** Chooses the cover story and writes cover lines and teasers. */
export async function selectCover(input: { stories: CoverStory[] }, ctx: AiServiceContext = {}) {
  return runService({
    service: "cover_selector",
    schemaName: "cover_selection",
    schema: coverSchema,
    input: { stories: input.stories.map((s) => `${s.id} | ${s.headline} | ${s.standfirst ?? ""} | ${s.storyType} | ${s.photos} | ${s.score}`).join("\n") || "—", storyList: input.stories },
    ctx,
  });
}
