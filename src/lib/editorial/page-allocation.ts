/**
 * Deterministic page allocation ("regenerate layout"): turns sections and stories into an ordered
 * list of pages with templates, respecting section order, keeping Business Deep Dives together,
 * packing 2–4 short stories of a section into NEWS_GRID pages and adding cover, contents and back
 * page. Pure: the flatplan module persists the result.
 */
import { PAGE_TEMPLATES, templateByCode } from "@/lib/constants";

export type PlanSection = { id?: string; slug: string; name: string; sortOrder: number; isHidden?: boolean };

export type PlanStory = {
  id: string;
  sectionSlug: string | null;
  storyType: string;
  wordCount: number;
  mediaCount: number;
  targetLength?: string | null;
  suggestedTemplate?: string | null;
  priority?: number;
  isCover?: boolean;
};

export type PlannedPage = {
  pageNumber: number;
  template: string;
  sectionSlug: string;
  storyIds: string[];
  continuation: boolean;
  continuationOfPage: number | null;
  capacityWords: number;
  contentWords: number;
  imageSlots: number;
  mediaSlotsUsed: number;
};

export type PageAllocation = { pages: PlannedPage[]; warnings: string[] };

const SHORT_WORDS = 320;
const OVERFLOW_TOLERANCE = 1.15;
const FRONT_SECTIONS = new Set(["cover", "this-month"]);
const BACK_SECTIONS = new Set(["back-page"]);

export function templateForStory(story: Pick<PlanStory, "storyType" | "mediaCount" | "wordCount" | "targetLength" | "suggestedTemplate">): string {
  if (story.suggestedTemplate && PAGE_TEMPLATES.some((t) => t.code === story.suggestedTemplate)) return story.suggestedTemplate;
  return defaultTemplateForStoryType(story.storyType, story);
}

export function defaultTemplateForStoryType(storyType: string, story?: Pick<PlanStory, "mediaCount" | "wordCount" | "targetLength">): string {
  switch (storyType) {
    case "BUSINESS_DEEP_DIVE":
      return "BDD_CASE";
    case "INTERVIEW_PROFILE":
      return "INTERVIEW";
    case "PHOTO_STORY":
      return "PHOTO_STORY";
    case "UPCOMING_EVENT":
      return "EVENT";
    case "ANECDOTE":
      return "SHORTS";
    case "STUDENT_PROJECT":
    case "STUDENT_ACHIEVEMENT":
      return story && story.mediaCount > 0 && (story.wordCount > 500 || story.targetLength === "LONG" || story.targetLength === "FEATURE") ? "ARTICLE_HERO" : "ARTICLE_TWO_COLUMN";
    default:
      return story && (story.targetLength === "FEATURE" || story.wordCount > 900) ? "ARTICLE_THREE_COLUMN" : "ARTICLE_TWO_COLUMN";
  }
}

function isShort(story: PlanStory): boolean {
  if (["BUSINESS_DEEP_DIVE", "INTERVIEW_PROFILE", "PHOTO_STORY", "UPCOMING_EVENT"].includes(story.storyType)) return false;
  return story.wordCount <= SHORT_WORDS && story.targetLength !== "LONG" && story.targetLength !== "FEATURE";
}

export function planPages(input: { sections: PlanSection[]; stories: PlanStory[]; targetPageCount?: number | null }): PageAllocation {
  const warnings: string[] = [];
  const pages: PlannedPage[] = [];
  const sections = [...input.sections].filter((s) => !s.isHidden).sort((a, b) => a.sortOrder - b.sortOrder);
  const slugs = new Set(sections.map((s) => s.slug));
  const fallbackSlug = sections.find((s) => !FRONT_SECTIONS.has(s.slug) && !BACK_SECTIONS.has(s.slug))?.slug ?? sections[0]?.slug ?? "campus-life";

  const add = (page: Omit<PlannedPage, "pageNumber">) => {
    pages.push({ ...page, pageNumber: pages.length + 1 });
    return pages[pages.length - 1];
  };

  const coverStory = input.stories.find((s) => s.isCover);
  const coverTemplate = templateByCode(coverStory && coverStory.mediaCount > 0 ? "COVER_A" : "COVER_B");
  add({ template: coverTemplate.code, sectionSlug: slugs.has("cover") ? "cover" : fallbackSlug, storyIds: coverStory ? [coverStory.id] : [], continuation: false, continuationOfPage: null, capacityWords: coverTemplate.capacityWords, contentWords: 0, imageSlots: coverTemplate.imageSlots, mediaSlotsUsed: coverStory && coverStory.mediaCount > 0 ? 1 : 0 });
  const contents = templateByCode("CONTENTS");
  add({ template: contents.code, sectionSlug: slugs.has("this-month") ? "this-month" : fallbackSlug, storyIds: [], continuation: false, continuationOfPage: null, capacityWords: contents.capacityWords, contentWords: 0, imageSlots: contents.imageSlots, mediaSlotsUsed: 0 });

  const bySection = new Map<string, PlanStory[]>();
  for (const story of input.stories) {
    const slug = story.sectionSlug && slugs.has(story.sectionSlug) ? story.sectionSlug : story.storyType === "BUSINESS_DEEP_DIVE" && slugs.has("bdd") ? "bdd" : fallbackSlug;
    if (!story.sectionSlug || !slugs.has(story.sectionSlug)) warnings.push(`Story ${story.id} has no visible section; placed in "${slug}".`);
    const list = bySection.get(slug) ?? [];
    list.push(story);
    bySection.set(slug, list);
  }

  const placeStory = (story: PlanStory, sectionSlug: string) => {
    const template = templateByCode(templateForStory(story));
    const first = add({ template: template.code, sectionSlug, storyIds: [story.id], continuation: false, continuationOfPage: null, capacityWords: template.capacityWords, contentWords: Math.min(story.wordCount, template.capacityWords), imageSlots: template.imageSlots, mediaSlotsUsed: Math.min(template.imageSlots, story.mediaCount) });
    let remaining = story.wordCount - template.capacityWords * OVERFLOW_TOLERANCE;
    let remainingMedia = story.mediaCount - template.imageSlots;
    let guard = 0;
    while ((remaining > 0 || (story.storyType === "BUSINESS_DEEP_DIVE" && remainingMedia >= 2)) && guard < 4) {
      guard += 1;
      const contCode = story.storyType === "BUSINESS_DEEP_DIVE" && remainingMedia >= 2 ? "BDD_VISUAL" : template.code === "INTERVIEW" || template.code === "PROFILE" ? "ARTICLE_TWO_COLUMN" : template.code === "PHOTO_STORY" ? "PHOTO_STORY" : "ARTICLE_TWO_COLUMN";
      const cont = templateByCode(contCode);
      add({ template: cont.code, sectionSlug, storyIds: [story.id], continuation: true, continuationOfPage: first.pageNumber, capacityWords: cont.capacityWords, contentWords: Math.max(0, Math.min(remaining, cont.capacityWords)), imageSlots: cont.imageSlots, mediaSlotsUsed: Math.max(0, Math.min(cont.imageSlots, remainingMedia)) });
      remaining -= cont.capacityWords;
      remainingMedia -= cont.imageSlots;
    }
    if (remaining > 0) warnings.push(`Story ${story.id} still overflows by about ${Math.round(remaining)} words after ${guard} continuation pages.`);
  };

  for (const section of sections) {
    if (FRONT_SECTIONS.has(section.slug) || BACK_SECTIONS.has(section.slug)) continue;
    const stories = [...(bySection.get(section.slug) ?? [])].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50) || a.id.localeCompare(b.id));
    if (!stories.length) continue;
    const long = stories.filter((s) => !isShort(s));
    const short = stories.filter(isShort);
    // Business Deep Dives are kept together and lead their section.
    const bdds = long.filter((s) => s.storyType === "BUSINESS_DEEP_DIVE");
    const others = long.filter((s) => s.storyType !== "BUSINESS_DEEP_DIVE");
    for (const story of [...bdds, ...others]) placeStory(story, section.slug);

    // Pack short stories 2–4 per NEWS_GRID page (SHORTS for anecdotes), a lone one gets its own page.
    const grid = templateByCode("NEWS_GRID");
    let batch: PlanStory[] = [];
    let batchWords = 0;
    const flush = () => {
      if (!batch.length) return;
      if (batch.length === 1) {
        placeStory(batch[0], section.slug);
      } else {
        const anecdotes = batch.every((s) => s.storyType === "ANECDOTE");
        const tpl = anecdotes ? templateByCode("SHORTS") : grid;
        add({ template: tpl.code, sectionSlug: section.slug, storyIds: batch.map((s) => s.id), continuation: false, continuationOfPage: null, capacityWords: tpl.capacityWords, contentWords: batchWords, imageSlots: tpl.imageSlots, mediaSlotsUsed: Math.min(tpl.imageSlots, batch.reduce((n, s) => n + (s.mediaCount > 0 ? 1 : 0), 0)) });
      }
      batch = [];
      batchWords = 0;
    };
    for (const story of short) {
      if (batch.length >= 4 || (batch.length && batchWords + story.wordCount > grid.capacityWords)) flush();
      batch.push(story);
      batchWords += story.wordCount;
    }
    flush();
  }

  const back = templateByCode("BACK_PAGE");
  const backStories = [...BACK_SECTIONS].flatMap((slug) => bySection.get(slug) ?? []);
  add({ template: back.code, sectionSlug: slugs.has("back-page") ? "back-page" : fallbackSlug, storyIds: backStories.map((s) => s.id), continuation: false, continuationOfPage: null, capacityWords: back.capacityWords, contentWords: backStories.reduce((n, s) => n + s.wordCount, 0), imageSlots: back.imageSlots, mediaSlotsUsed: Math.min(back.imageSlots, backStories.reduce((n, s) => n + s.mediaCount, 0)) });

  if (pages.length % 4 !== 0) warnings.push(`${pages.length} pages: a printed booklet needs a multiple of 4 (add ${4 - (pages.length % 4)} page(s) or merge short stories).`);
  if (input.targetPageCount && pages.length > input.targetPageCount) warnings.push(`${pages.length} pages exceed the target of ${input.targetPageCount}.`);
  return { pages, warnings };
}
