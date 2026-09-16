/**
 * Campus coverage of an edition: how evenly submissions, selected stories and approved
 * articles are spread across campuses. Used by the control room and the coverage automation.
 */
import { and, asc, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { articles, campuses, stories, storyCampuses, submissionCampuses, submissions } from "@/server/db/schema";

export const SELECTED_STORY_STATUSES = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED"] as const;
export const APPROVED_ARTICLE_STATUSES = ["APPROVED", "LOCKED"] as const;

export type CampusCoverage = {
  campusId: string;
  name: string;
  slug: string;
  colour: string | null;
  submissions: number;
  storiesSelected: number;
  articlesApproved: number;
  /** Share of campus-linked submissions (0–1). */
  share: number;
};

export type CoverageBalance = {
  /** min / max submissions across active campuses; 1 = perfectly balanced, 0 = a campus has nothing. */
  score: number;
  /** Campuses with fewer than half the average number of submissions. */
  underrepresented: string[];
  average: number;
  label: "Balanced" | "Uneven" | "Critical";
};

export type EditionCoverage = {
  editionId: string;
  campuses: CampusCoverage[];
  schoolWide: { submissions: number; stories: number };
  balance: CoverageBalance;
  totals: { submissions: number; storiesSelected: number; articlesApproved: number };
};

export function balanceFromCounts(counts: number[]): CoverageBalance & { underrepresentedIndexes: number[] } {
  if (!counts.length) return { score: 1, underrepresented: [], underrepresentedIndexes: [], average: 0, label: "Balanced" };
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const average = total / counts.length;
  const underrepresentedIndexes = average > 0 ? counts.map((n, i) => (n < average * 0.5 ? i : -1)).filter((i) => i >= 0) : [];
  const score = max === 0 ? 0 : Math.round((min / max) * 1000) / 1000;
  let label: CoverageBalance["label"];
  if (total === 0 || score < 0.3) label = "Critical";
  else if (score < 0.6 || underrepresentedIndexes.length) label = "Uneven";
  else label = "Balanced";
  return { score, underrepresented: [], underrepresentedIndexes, average: Math.round(average * 100) / 100, label };
}

export async function coverageByCampus(editionId: string): Promise<EditionCoverage> {
  const campusRows = await db
    .select({ id: campuses.id, name: campuses.name, slug: campuses.slug, colour: campuses.colour })
    .from(campuses)
    .where(eq(campuses.isActive, true))
    .orderBy(asc(campuses.sortOrder));

  const submissionRows = await db
    .select({ campusId: submissionCampuses.campusId, n: count() })
    .from(submissionCampuses)
    .innerJoin(submissions, eq(submissions.id, submissionCampuses.submissionId))
    .where(and(eq(submissions.editionId, editionId), ne(submissions.status, "DRAFT"), ne(submissions.status, "ARCHIVED")))
    .groupBy(submissionCampuses.campusId);

  const storyRows = await db
    .select({ campusId: storyCampuses.campusId, n: count() })
    .from(storyCampuses)
    .innerJoin(stories, eq(stories.id, storyCampuses.storyId))
    .where(and(eq(stories.editionId, editionId), inArray(stories.status, [...SELECTED_STORY_STATUSES])))
    .groupBy(storyCampuses.campusId);

  const articleRows = await db
    .select({ campusId: storyCampuses.campusId, n: count() })
    .from(storyCampuses)
    .innerJoin(stories, eq(stories.id, storyCampuses.storyId))
    .innerJoin(articles, eq(articles.storyId, stories.id))
    .where(and(eq(stories.editionId, editionId), inArray(articles.status, [...APPROVED_ARTICLE_STATUSES])))
    .groupBy(storyCampuses.campusId);

  const [schoolSubs] = await db
    .select({ n: count() })
    .from(submissions)
    .where(and(eq(submissions.editionId, editionId), ne(submissions.status, "DRAFT"), ne(submissions.status, "ARCHIVED"), eq(submissions.campusScope, "SCHOOL_WIDE")));
  // Selected stories without any campus link are school-wide.
  const [schoolStoryCount] = await db
    .select({ n: count() })
    .from(stories)
    .leftJoin(storyCampuses, eq(storyCampuses.storyId, stories.id))
    .where(and(eq(stories.editionId, editionId), inArray(stories.status, [...SELECTED_STORY_STATUSES]), isNull(storyCampuses.storyId)));
  const schoolStories = schoolStoryCount?.n ?? 0;

  const subs = new Map(submissionRows.map((r) => [r.campusId, r.n]));
  const sel = new Map(storyRows.map((r) => [r.campusId, r.n]));
  const appr = new Map(articleRows.map((r) => [r.campusId, r.n]));
  const totalLinked = campusRows.reduce((n, c) => n + (subs.get(c.id) ?? 0), 0);

  const list: CampusCoverage[] = campusRows.map((c) => ({
    campusId: c.id,
    name: c.name,
    slug: c.slug,
    colour: c.colour,
    submissions: subs.get(c.id) ?? 0,
    storiesSelected: sel.get(c.id) ?? 0,
    articlesApproved: appr.get(c.id) ?? 0,
    share: totalLinked ? Math.round(((subs.get(c.id) ?? 0) / totalLinked) * 1000) / 1000 : 0,
  }));

  const balance = balanceFromCounts(list.map((c) => c.submissions));
  return {
    editionId,
    campuses: list,
    schoolWide: { submissions: schoolSubs?.n ?? 0, stories: schoolStories },
    balance: { score: balance.score, underrepresented: balance.underrepresentedIndexes.map((i) => list[i].campusId), average: balance.average, label: balance.label },
    totals: {
      submissions: totalLinked + (schoolSubs?.n ?? 0),
      storiesSelected: list.reduce((n, c) => n + c.storiesSelected, 0) + schoolStories,
      articlesApproved: list.reduce((n, c) => n + c.articlesApproved, 0),
    },
  };
}
