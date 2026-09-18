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

/**
 * Whether the page count is a target or a promise.
 *
 * `auto` sizes the issue to the copy: the reason most pages came out half empty was that the paper
 * was decided before the words were counted. `fixed` is for the customer who has to hand a printer
 * a set number of pages — a booklet is bound in multiples of four, a wrap has a fixed extent — and
 * there the count is kept and the room is spent on pictures and on giving stories more air.
 */
export type PageCountMode = "auto" | "fixed";

/**
 * A story earns a page of its own when it can fill one.
 *
 * The old rule asked only whether a story was under 320 words. Everything above that got a page to
 * itself, so a 400-word item was set on a template built for 720 and the page came out half empty —
 * which is most of the white space people complain about. The rule is now relative to the paper:
 * unless a story fills this much of the tightest template that suits it, it shares a page.
 */
const SOLO_FILL = 0.62;
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

/**
 * The tightest template that still holds the story, used when a page has to be conjured.
 *
 * Declared capacities are estimates: a hero page says 520 words but spends a third of the sheet on
 * a photograph, so choosing "the tightest that fits" for every story fought the measuring pass and
 * produced more jump pages, not fewer. It is therefore kept for the one place that needs a template
 * out of nothing — filling a fixed extent — and story placement keeps the template its type asks
 * for, which the engine is then free to swap after measuring the real thing.
 */
export function tightestTemplateFor(story: Pick<PlanStory, "storyType" | "mediaCount" | "wordCount" | "targetLength" | "suggestedTemplate">): string {
  const wanted = templateForStory(story);
  if (story.suggestedTemplate === wanted) return wanted;
  const family = templateByCode(wanted).family;
  // Structured pages carry meaning in their shape; only the plain article family is interchangeable.
  if (family !== "article") return wanted;
  const needed = story.wordCount * OVERFLOW_TOLERANCE;
  const fits = PAGE_TEMPLATES.filter((t) => t.family === "article" && t.imageSlots <= Math.max(1, story.mediaCount) + 1 && t.capacityWords >= needed).sort((a, b) => a.capacityWords - b.capacityWords);
  return fits[0]?.code ?? wanted;
}

function isShort(story: PlanStory): boolean {
  if (["BUSINESS_DEEP_DIVE", "INTERVIEW_PROFILE", "PHOTO_STORY", "UPCOMING_EVENT"].includes(story.storyType)) return false;
  if (story.targetLength === "LONG" || story.targetLength === "FEATURE") return false;
  const template = templateByCode(templateForStory(story));
  return story.wordCount < template.capacityWords * SOLO_FILL;
}

export function planPages(input: { sections: PlanSection[]; stories: PlanStory[]; targetPageCount?: number | null; pageCountMode?: PageCountMode }): PageAllocation {
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

  /**
   * Pictures that do not fit only earn a page when the extent is a promise.
   *
   * A Business Deep Dive that brought five screenshots used to get a picture page for the three the
   * case page could not hold — a page with no words on it. That is a good page to have when a
   * printer has been promised a set number of sheets and the alternative is white space; it is a
   * wasted sheet when the issue is free to be shorter. So in `auto` the spare pictures wait in the
   * library, and in `fixed` they are the first thing spent (see expandToTarget).
   */
  const picturePages = input.pageCountMode === "fixed";

  const placeStory = (story: PlanStory, sectionSlug: string) => {
    const template = templateByCode(templateForStory(story));
    const first = add({ template: template.code, sectionSlug, storyIds: [story.id], continuation: false, continuationOfPage: null, capacityWords: template.capacityWords, contentWords: Math.min(story.wordCount, template.capacityWords), imageSlots: template.imageSlots, mediaSlotsUsed: Math.min(template.imageSlots, story.mediaCount) });
    let remaining = story.wordCount - template.capacityWords * OVERFLOW_TOLERANCE;
    let remainingMedia = story.mediaCount - template.imageSlots;
    let guard = 0;
    while ((remaining > 0 || (picturePages && story.storyType === "BUSINESS_DEEP_DIVE" && remainingMedia >= 2)) && guard < 4) {
      guard += 1;
      const contCode = story.storyType === "BUSINESS_DEEP_DIVE" && remainingMedia >= 2 ? "BDD_VISUAL" : template.code === "INTERVIEW" || template.code === "PROFILE" ? "ARTICLE_TWO_COLUMN" : template.code === "PHOTO_STORY" ? "PHOTO_STORY" : "ARTICLE_TWO_COLUMN";
      const cont = templateByCode(contCode);
      add({ template: cont.code, sectionSlug, storyIds: [story.id], continuation: true, continuationOfPage: first.pageNumber, capacityWords: cont.capacityWords, contentWords: Math.max(0, Math.min(remaining, cont.capacityWords)), imageSlots: cont.imageSlots, mediaSlotsUsed: Math.max(0, Math.min(cont.imageSlots, remainingMedia)) });
      remaining -= cont.capacityWords;
      remainingMedia -= cont.imageSlots;
    }
    if (remaining > 0) warnings.push(`Story ${story.id} still overflows by about ${Math.round(remaining)} words after ${guard} continuation pages.`);
  };

  /**
   * Short items are packed across section boundaries, not only within one.
   *
   * A section with a single short story used to get a whole page for it, and an issue with nine
   * sections produced nine near-empty pages. A news page already prints each item's own kicker, so
   * two sections sharing one sheet reads exactly as a magazine's "in brief" page does. The page is
   * filed under its first story's section, which keeps the running order intact.
   */
  const grid = templateByCode("NEWS_GRID");
  let batch: { story: PlanStory; sectionSlug: string }[] = [];
  let batchWords = 0;
  let batchStartedAt = -1;
  const flush = () => {
    if (!batch.length) return;
    const anecdotes = batch.every((b) => b.story.storyType === "ANECDOTE");
    const tpl = anecdotes ? templateByCode("SHORTS") : grid;
    add({
      template: tpl.code,
      sectionSlug: batch[0].sectionSlug,
      storyIds: batch.map((b) => b.story.id),
      continuation: false,
      continuationOfPage: null,
      capacityWords: tpl.capacityWords,
      contentWords: batchWords,
      imageSlots: tpl.imageSlots,
      mediaSlotsUsed: Math.min(tpl.imageSlots, batch.reduce((n, b) => n + (b.story.mediaCount > 0 ? 1 : 0), 0)),
    });
    batch = [];
    batchWords = 0;
    batchStartedAt = -1;
  };

  for (const [sectionIndex, section] of sections.entries()) {
    if (FRONT_SECTIONS.has(section.slug) || BACK_SECTIONS.has(section.slug)) continue;
    const stories = [...(bySection.get(section.slug) ?? [])].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50) || a.id.localeCompare(b.id));
    if (!stories.length) continue;
    const long = stories.filter((s) => !isShort(s));
    const short = stories.filter(isShort);
    // Business Deep Dives are kept together and lead their section.
    const bdds = long.filter((s) => s.storyType === "BUSINESS_DEEP_DIVE");
    const others = long.filter((s) => s.storyType !== "BUSINESS_DEEP_DIVE");
    // A leftover short may wait for the next section's shorts, but no longer than that: a page of
    // briefs two sections from where it started stops belonging anywhere.
    if (batch.length && batchStartedAt >= 0 && sectionIndex - batchStartedAt > 1) flush();
    for (const story of [...bdds, ...others]) placeStory(story, section.slug);

    for (const story of short) {
      if (batch.length >= 4 || (batch.length && batchWords + story.wordCount > grid.capacityWords)) flush();
      if (!batch.length) batchStartedAt = sectionIndex;
      batch.push({ story, sectionSlug: section.slug });
      batchWords += story.wordCount;
    }
  }
  flush();

  const back = templateByCode("BACK_PAGE");
  const backStories = [...BACK_SECTIONS].flatMap((slug) => bySection.get(slug) ?? []);
  add({ template: back.code, sectionSlug: slugs.has("back-page") ? "back-page" : fallbackSlug, storyIds: backStories.map((s) => s.id), continuation: false, continuationOfPage: null, capacityWords: back.capacityWords, contentWords: backStories.reduce((n, s) => n + s.wordCount, 0), imageSlots: back.imageSlots, mediaSlotsUsed: Math.min(back.imageSlots, backStories.reduce((n, s) => n + s.mediaCount, 0)) });

  if (input.pageCountMode === "fixed" && input.targetPageCount) {
    const grown = expandToTarget(pages, input.targetPageCount, input.stories);
    warnings.push(...grown.warnings);
  }

  pages.forEach((page, index) => {
    page.pageNumber = index + 1;
  });
  for (const page of pages) {
    if (page.continuationOfPage !== null) {
      const parent = pages.find((p) => p.storyIds[0] && page.storyIds[0] === p.storyIds[0] && !p.continuation);
      page.continuationOfPage = parent?.pageNumber ?? page.continuationOfPage;
    }
  }

  if (pages.length % 4 !== 0) warnings.push(`${pages.length} pages: a printed booklet needs a multiple of 4 (add ${4 - (pages.length % 4)} page(s) or merge short stories).`);
  if (input.targetPageCount && input.pageCountMode !== "fixed" && pages.length > input.targetPageCount) warnings.push(`${pages.length} pages exceed the target of ${input.targetPageCount}.`);
  return { pages, warnings };
}

/**
 * Spends the pages a fixed extent still owes, the way a magazine would.
 *
 * First on pictures, because a picture page is the one kind of page that is better for being
 * large: a story that brought photographs nobody has room for gets a photo page. Then by undoing
 * the packing, one story at a time, so a news page becomes two proper pages rather than one dense
 * one. Both are reversible and neither invents words.
 *
 * It never removes pages: an issue that already needs more than its extent is a different problem,
 * reported as a warning rather than solved by cutting somebody's story.
 */
export function expandToTarget(pages: PlannedPage[], target: number, stories: PlanStory[]): { warnings: string[] } {
  const warnings: string[] = [];
  if (pages.length >= target) {
    if (pages.length > target) warnings.push(`${pages.length} pages against a fixed extent of ${target}: shorten a story or raise the extent.`);
    return { warnings };
  }
  const byId = new Map(stories.map((s) => [s.id, s]));
  const photo = templateByCode("PHOTO_STORY");
  // The front and the back of a magazine are fixed furniture: the cover, the contents and the back
  // page are where they are, and nothing is ever inserted between them and the issue.
  const furniture = new Set(["COVER_A", "COVER_B", "CONTENTS", "BACK_PAGE"]);
  let guard = 0;

  // 1 · Photographs nobody has room for become a picture page beside their story.
  while (pages.length < target && guard < 64) {
    guard += 1;
    const index = pages.findIndex((page) => {
      if (page.continuation || page.storyIds.length !== 1 || furniture.has(page.template)) return false;
      const story = byId.get(page.storyIds[0]);
      return !!story && story.mediaCount - page.mediaSlotsUsed >= 2;
    });
    if (index < 0) break;
    const page = pages[index];
    const story = byId.get(page.storyIds[0])!;
    const spare = story.mediaCount - page.mediaSlotsUsed;
    pages.splice(index + 1, 0, {
      pageNumber: 0,
      template: photo.code,
      sectionSlug: page.sectionSlug,
      storyIds: [story.id],
      continuation: true,
      continuationOfPage: page.pageNumber,
      capacityWords: photo.capacityWords,
      contentWords: 0,
      imageSlots: photo.imageSlots,
      mediaSlotsUsed: Math.min(photo.imageSlots, spare),
    });
    page.mediaSlotsUsed += Math.min(photo.imageSlots, spare);
  }

  // 2 · Undo the packing: the largest news page gives its last story a page of its own.
  guard = 0;
  while (pages.length < target && guard < 64) {
    guard += 1;
    const index = pages.findIndex((page) => page.storyIds.length > 1 && !furniture.has(page.template));
    if (index < 0) break;
    const page = pages[index];
    const movedId = page.storyIds[page.storyIds.length - 1];
    const story = byId.get(movedId);
    page.storyIds = page.storyIds.slice(0, -1);
    page.contentWords = Math.max(0, page.contentWords - (story?.wordCount ?? 0));
    const template = templateByCode(story ? tightestTemplateFor(story) : "ARTICLE_TWO_COLUMN");
    pages.splice(index + 1, 0, {
      pageNumber: 0,
      template: template.code,
      sectionSlug: page.sectionSlug,
      storyIds: [movedId],
      continuation: false,
      continuationOfPage: null,
      capacityWords: template.capacityWords,
      contentWords: Math.min(story?.wordCount ?? 0, template.capacityWords),
      imageSlots: template.imageSlots,
      mediaSlotsUsed: Math.min(template.imageSlots, story?.mediaCount ?? 0),
    });
  }

  if (pages.length < target) warnings.push(`${pages.length} pages against a fixed extent of ${target}: there is not enough material to fill it honestly.`);
  return { warnings };
}
