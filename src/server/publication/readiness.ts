import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";

/**
 * Whether there is anything in an edition worth looking at yet.
 *
 * The preview, the PDF and the Word file were offered from the moment an edition existed, which is
 * weeks before it contains a word. Pressing them produced a document with a cover and nothing
 * behind it — not an error, which would at least have said something, but a real file with real
 * page furniture and no newsletter in it. A person who has just created an issue and wants to know
 * what Briefly will make of it gets an answer that looks like a broken product.
 *
 * The honest gate is the same count the overview already draws its summary from: an article with
 * words in it, on a story that is actually in this issue. A story that was dropped does not count,
 * and neither does an article nobody has written yet. As soon as one piece has been drafted the
 * preview is worth opening, unapproved and unfinished included — that is what a live preview is
 * for. Before that there is nothing to show, and the interface should offer the models instead.
 *
 * Kept here rather than in either screen so the routes enforce the same rule the buttons do: the
 * preview URL is the kind people bookmark and send to each other.
 */

/** The stories that are part of the issue, as the dashboard counts them. */
const IN_THE_ISSUE = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"] as const;

export async function editionHasContent(editionId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(s.articles)
    .innerJoin(s.stories, eq(s.articles.storyId, s.stories.id))
    .where(and(eq(s.articles.editionId, editionId), inArray(s.stories.status, [...IN_THE_ISSUE]), sql`${s.articles.status} <> 'EMPTY'`));
  return Number(row?.n ?? 0) > 0;
}
