/**
 * Page allocation is pure code (no model). The planner lives in src/lib/editorial/page-allocation.ts;
 * this service adds the database-aware entry point used by the flatplan "regenerate layout" action.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { articles, editionSections, editions, stories, storyMedia } from "@/server/db/schema";
import { NotFoundError } from "@/lib/action-result";
import { planPages, type PageAllocation, type PlanSection, type PlanStory } from "@/lib/editorial/page-allocation";

export { planPages, templateForStory, defaultTemplateForStoryType } from "@/lib/editorial/page-allocation";
export type { PageAllocation, PlanSection, PlanStory, PlannedPage } from "@/lib/editorial/page-allocation";

const PLACEABLE_STATUSES = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"] as const;

/** Builds a page allocation for an edition from its visible sections and selected stories. */
export async function planEditionPageAllocation(editionId: string, options: { includeCandidates?: boolean } = {}): Promise<PageAllocation & { sections: PlanSection[]; stories: PlanStory[] }> {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const sectionRows = await db.query.editionSections.findMany({ where: eq(editionSections.editionId, editionId) });
  const statuses = options.includeCandidates ? [...PLACEABLE_STATUSES, "CANDIDATE" as const] : [...PLACEABLE_STATUSES];
  const storyRows = await db
    .select({
      id: stories.id,
      sectionId: stories.sectionId,
      storyType: stories.storyType,
      priority: stories.priority,
      isCover: stories.isCover,
      targetLength: stories.targetLength,
      suggestedTemplate: stories.suggestedTemplate,
      wordCount: sql<number>`coalesce(${articles.wordCount}, 0)`,
    })
    .from(stories)
    .leftJoin(articles, eq(articles.storyId, stories.id))
    .where(and(eq(stories.editionId, editionId), inArray(stories.status, statuses)));
  const mediaCounts = storyRows.length
    ? await db
        .select({ storyId: storyMedia.storyId, n: sql<number>`count(*)::int` })
        .from(storyMedia)
        .where(inArray(storyMedia.storyId, storyRows.map((s) => s.id)))
        .groupBy(storyMedia.storyId)
    : [];
  const mediaByStory = new Map(mediaCounts.map((m) => [m.storyId, Number(m.n)]));
  const sectionById = new Map(sectionRows.map((s) => [s.id, s]));
  const sections: PlanSection[] = sectionRows.map((s) => ({ id: s.id, slug: s.slug, name: s.name, sortOrder: s.sortOrder, isHidden: s.isHidden }));
  const planStories: PlanStory[] = storyRows.map((s) => ({
    id: s.id,
    sectionSlug: s.sectionId ? (sectionById.get(s.sectionId)?.slug ?? null) : null,
    storyType: s.storyType,
    wordCount: Number(s.wordCount) || 0,
    mediaCount: mediaByStory.get(s.id) ?? 0,
    targetLength: s.targetLength,
    suggestedTemplate: s.suggestedTemplate,
    priority: s.priority,
    isCover: s.isCover,
  }));
  const plan = planPages({ sections, stories: planStories, targetPageCount: edition.targetPageCount, pageCountMode: edition.pageCountMode === "fixed" ? "fixed" : "auto" });
  return { ...plan, sections, stories: planStories };
}
