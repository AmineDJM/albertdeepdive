import { describe, expect, it } from "vitest";
import { DEFAULT_SECTIONS } from "@/lib/constants";
import { planPages, templateForStory, type PlanStory } from "@/lib/editorial/page-allocation";

const sections = DEFAULT_SECTIONS.map((s, i) => ({ slug: s.slug, name: s.name, sortOrder: i }));

const story = (id: string, sectionSlug: string, storyType: string, wordCount: number, mediaCount: number, extra: Partial<PlanStory> = {}): PlanStory => ({ id, sectionSlug, storyType, wordCount, mediaCount, ...extra });

describe("page allocation planner", () => {
  const stories: PlanStory[] = [
    story("bdd-1", "bdd", "BUSINESS_DEEP_DIVE", 520, 4, { priority: 90, isCover: true }),
    story("bdd-2", "bdd", "BUSINESS_DEEP_DIVE", 430, 1, { priority: 70 }),
    story("bdd-3", "bdd", "BUSINESS_DEEP_DIVE", 300, 2, { priority: 60 }),
    story("interview", "spotlight", "INTERVIEW_PROFILE", 700, 1, { priority: 84 }),
    story("feature", "projects", "STUDENT_PROJECT", 1300, 2, { priority: 80, targetLength: "FEATURE" }),
    story("news-1", "actus", "SCHOOL_NEWS", 180, 1, { priority: 50 }),
    story("news-2", "actus", "SCHOOL_NEWS", 210, 0, { priority: 55 }),
    story("news-3", "actus", "ACADEMIC_NEWS", 150, 1, { priority: 45 }),
    story("news-long", "actus", "SCHOOL_NEWS", 600, 1, { priority: 65 }),
    story("event", "events", "UPCOMING_EVENT", 140, 2, { priority: 40 }),
    story("anecdote-1", "campus-life", "ANECDOTE", 120, 0),
    story("anecdote-2", "campus-life", "ANECDOTE", 90, 0),
    story("community", "back-page", "OTHER", 200, 1),
  ];
  const plan = planPages({ sections, stories, targetPageCount: 24 });
  const pages = plan.pages;

  it("adds a cover, a contents page and a back page", () => {
    expect(pages[0]).toMatchObject({ pageNumber: 1, template: "COVER_A", sectionSlug: "cover", storyIds: ["bdd-1"] });
    expect(pages[1]).toMatchObject({ pageNumber: 2, template: "CONTENTS", sectionSlug: "this-month" });
    expect(pages[pages.length - 1]).toMatchObject({ template: "BACK_PAGE", sectionSlug: "back-page", storyIds: ["community"] });
    expect(pages.map((p) => p.pageNumber)).toEqual(pages.map((_, i) => i + 1));
  });

  it("respects the section order and keeps Business Deep Dives together", () => {
    const order = sections.map((s) => s.slug);
    const slugs: string[] = pages.map((p) => p.sectionSlug);
    for (let i = 1; i < slugs.length; i += 1) expect(order.indexOf(slugs[i] as (typeof order)[number])).toBeGreaterThanOrEqual(order.indexOf(slugs[i - 1] as (typeof order)[number]));
    // Section pages only: the cover legitimately carries the cover story, which is a BDD here.
    const bddPages = pages.filter((p) => p.sectionSlug === "bdd");
    const numbers = bddPages.map((p) => p.pageNumber);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => numbers[0] + i));
    expect(bddPages[0].storyIds).toEqual(["bdd-1"]);
    expect(bddPages.every((p) => p.template.startsWith("BDD_"))).toBe(true);
    // In `auto` the four pictures bdd-1 brought do not buy a page of their own: see the fixed-extent
    // test below, where they do.
    expect(bddPages.filter((p) => p.storyIds[0] === "bdd-1").map((p) => p.template)).toEqual(["BDD_CASE"]);
  });

  it("packs 2–4 short stories of a section into a NEWS_GRID and gives long ones their own page", () => {
    const grid = pages.find((p) => p.template === "NEWS_GRID");
    expect(grid?.sectionSlug).toBe("actus");
    expect(grid?.storyIds.sort()).toEqual(["news-1", "news-2", "news-3"]);
    expect(pages.find((p) => p.storyIds.includes("news-long"))?.template).toBe("ARTICLE_TWO_COLUMN");
    expect(pages.find((p) => p.storyIds.includes("news-long"))?.pageNumber).toBeLessThan(grid!.pageNumber);
    const shorts = pages.find((p) => p.template === "SHORTS");
    expect(shorts?.storyIds.sort()).toEqual(["anecdote-1", "anecdote-2"]);
  });

  it("adds continuation pages for overflowing stories and uses templates by story type", () => {
    const featurePages = pages.filter((p) => p.storyIds.includes("feature"));
    expect(featurePages.length).toBeGreaterThanOrEqual(2);
    expect(featurePages[0].continuation).toBe(false);
    expect(featurePages[1]).toMatchObject({ continuation: true, continuationOfPage: featurePages[0].pageNumber });
    expect(pages.find((p) => p.storyIds.includes("interview"))?.template).toBe("INTERVIEW");
    expect(pages.find((p) => p.storyIds.includes("event"))?.template).toBe("EVENT");
    expect(templateForStory({ storyType: "PHOTO_STORY", mediaCount: 5, wordCount: 100 })).toBe("PHOTO_STORY");
    expect(templateForStory({ storyType: "SCHOOL_NEWS", mediaCount: 1, wordCount: 400, suggestedTemplate: "ARTICLE_HERO" })).toBe("ARTICLE_HERO");
  });

  it("warns about booklet page counts and stories without a section", () => {
    const small = planPages({ sections, stories: [story("x", "nowhere", "SCHOOL_NEWS", 200, 0)] });
    expect(small.warnings.some((w) => w.includes("no visible section"))).toBe(true);
    expect(small.pages.find((p) => p.storyIds.includes("x"))?.sectionSlug).toBe("spotlight");
    // Cover + contents + one story + back page is exactly 4, a valid booklet; a second story is not.
    expect(small.pages).toHaveLength(4);
    expect(small.warnings.some((w) => w.includes("multiple of 4"))).toBe(false);
    const odd = planPages({ sections, stories: [story("x", "spotlight", "SCHOOL_NEWS", 200, 0), story("y", "campus-life", "ANECDOTE", 200, 0)] });
    expect(odd.pages).toHaveLength(5);
    expect(odd.warnings.some((w) => w.includes("multiple of 4"))).toBe(true);
  });

  it("sizes the issue to the copy: a story that cannot fill a page shares one", () => {
    // 400 words on a template built for 720 is the half-empty page people complain about.
    const shortish = planPages({ sections, stories: [story("a", "actus", "SCHOOL_NEWS", 400, 1), story("b", "actus", "SCHOOL_NEWS", 200, 1)] });
    const shared = shortish.pages.find((p) => p.storyIds.length === 2);
    expect(shared?.storyIds.sort()).toEqual(["a", "b"]);
    // A story that does fill its page keeps it.
    const solo = planPages({ sections, stories: [story("a", "actus", "SCHOOL_NEWS", 640, 1), story("b", "actus", "SCHOOL_NEWS", 200, 1)] });
    expect(solo.pages.every((p) => p.storyIds.length <= 1)).toBe(true);
  });

  it("packs shorts across a section boundary rather than giving each section a near-empty page", () => {
    const spread = planPages({
      sections,
      stories: [story("a", "actus", "SCHOOL_NEWS", 150, 0), story("b", "campus-life", "ACADEMIC_NEWS", 150, 0), story("c", "associations", "ASSOCIATION", 150, 0)],
    });
    // Two neighbouring sections may share a page; a third section is too far to still belong.
    const packed = spread.pages.filter((p) => p.storyIds.length > 1);
    expect(packed.length).toBeGreaterThanOrEqual(1);
    expect(spread.pages.filter((p) => p.storyIds.some((id) => ["a", "b", "c"].includes(id))).length).toBeLessThan(3);
  });

  it("fills a fixed extent with pictures and unpacked pages instead of handing back a shorter issue", () => {
    const fixed = planPages({ sections, stories, targetPageCount: 16, pageCountMode: "fixed" });
    expect(fixed.pages).toHaveLength(16);
    expect(fixed.warnings).toEqual([]);
    // The spare photographs of a Business Deep Dive are what the extra room is spent on first.
    expect(fixed.pages.filter((p) => p.storyIds[0] === "bdd-1").map((p) => p.template)).toContain("BDD_VISUAL");
    // Nothing is inserted into the front or back furniture.
    expect(fixed.pages[0].template).toBe("COVER_A");
    expect(fixed.pages[1].template).toBe("CONTENTS");
    expect(fixed.pages[fixed.pages.length - 1].template).toBe("BACK_PAGE");
    // Page numbers and continuation links are renumbered after the expansion.
    expect(fixed.pages.map((p) => p.pageNumber)).toEqual(fixed.pages.map((_, i) => i + 1));
    for (const page of fixed.pages) {
      if (page.continuationOfPage === null) continue;
      expect(page.continuationOfPage).toBeLessThan(page.pageNumber);
    }
  });

  it("says so when a fixed extent cannot be filled honestly, rather than padding it", () => {
    const thin = planPages({ sections, stories: [story("a", "actus", "SCHOOL_NEWS", 200, 0)], targetPageCount: 32, pageCountMode: "fixed" });
    expect(thin.pages.length).toBeLessThan(32);
    expect(thin.warnings.some((w) => w.includes("not enough material"))).toBe(true);
  });

  it("says so when the copy needs more paper than a fixed extent allows", () => {
    const fat = planPages({ sections, stories, targetPageCount: 8, pageCountMode: "fixed" });
    expect(fat.pages.length).toBeGreaterThan(8);
    expect(fat.warnings.some((w) => w.includes("shorten a story or raise the extent"))).toBe(true);
  });
});
