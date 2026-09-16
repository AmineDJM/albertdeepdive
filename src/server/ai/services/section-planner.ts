import { z } from "zod";
import { PAGE_TEMPLATES } from "@/lib/constants";
import { runService, type AiServiceContext } from "./common";

export const sectionPlanSchema = z.object({
  stories: z.array(z.object({ storyId: z.string(), sectionSlug: z.string(), order: z.number(), template: z.string(), pages: z.number() })),
  coverStoryId: z.string().nullable(),
  spotlightStoryIds: z.array(z.string()),
  rationale: z.string(),
});
export type SectionPlanOutput = z.infer<typeof sectionPlanSchema>;

export type PlannerSection = { slug: string; name: string };
export type PlannerStory = { id: string; title: string; storyType: string; campuses: string[]; score: number; words: number; photos: number; hasHero: boolean; targetLength: string; currentSectionSlug?: string | null };

/** Assigns stories to sections, orders them and suggests templates for a balanced issue. */
export async function planSections(input: { sections: PlannerSection[]; stories: PlannerStory[]; targetPages: number }, ctx: AiServiceContext = {}) {
  return runService({
    service: "section_planner",
    schemaName: "section_plan",
    schema: sectionPlanSchema,
    input: {
      sections: input.sections.map((s) => `${s.slug}: ${s.name}`).join("\n") || "—",
      sectionList: input.sections,
      stories: input.stories.map((s) => `${s.id} | ${s.title} | ${s.storyType} | ${s.campuses.join(", ") || "school-wide"} | ${s.score} | ${s.words} | ${s.photos}`).join("\n") || "—",
      storyList: input.stories,
      targetPages: input.targetPages,
      templates: PAGE_TEMPLATES.map((t) => t.code),
    },
    ctx,
    maxOutputTokens: 3000,
  });
}
