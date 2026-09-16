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
    expect(bddPages.filter((p) => p.storyIds[0] === "bdd-1").map((p) => p.template)).toEqual(["BDD_CASE", "BDD_VISUAL"]);
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
});
