import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { articleRevisions, articleSources, articles, editionSections, editions, facts, quotes, stories, submissions } from "@/server/db/schema";
import { NotFoundError } from "@/lib/action-result";
import { listComments } from "./comments";

/**
 * Everything the article workbench renders in one round trip: the draft itself, the story it came
 * from, the sources behind it ("Why is this here?" needs them listed, not just per block), the
 * revision trail and the desk notes.
 */
export async function articleWorkbench(articleId: string) {
  const article = await db.query.articles.findFirst({ where: eq(articles.id, articleId) });
  if (!article) throw new NotFoundError("Article");

  const [story, edition, sourceRows, revisionRows, comments, storyFacts, storyQuotes] = await Promise.all([
    db.query.stories.findFirst({ where: eq(stories.id, article.storyId), with: { section: { columns: { id: true, name: true, slug: true } }, campuses: { with: { campus: { columns: { id: true, name: true, slug: true } } } } } }),
    db.query.editions.findFirst({ where: eq(editions.id, article.editionId), columns: { id: true, label: true, status: true } }),
    db.select({ role: articleSources.role, submissionId: articleSources.submissionId }).from(articleSources).where(eq(articleSources.articleId, articleId)),
    db.query.articleRevisions.findMany({ where: eq(articleRevisions.articleId, articleId), orderBy: [desc(articleRevisions.version)], limit: 30, with: { createdBy: { columns: { id: true, name: true } } } }),
    listComments("ARTICLE", articleId),
    db.query.facts.findMany({ where: eq(facts.storyId, article.storyId), orderBy: [asc(facts.createdAt)] }),
    db.query.quotes.findMany({ where: eq(quotes.storyId, article.storyId), orderBy: [desc(quotes.isPullQuoteCandidate), asc(quotes.createdAt)] }),
  ]);
  if (!story || !edition) throw new NotFoundError("Article");

  const subIds = sourceRows.map((r) => r.submissionId);
  const subs = subIds.length
    ? await db.query.submissions.findMany({
        where: inArray(submissions.id, subIds),
        columns: { id: true, title: true, storyType: true, status: true, description: true, createdAt: true },
        with: { contributor: { columns: { id: true, firstName: true, lastName: true, type: true } } },
      })
    : [];
  const roleOf = new Map(sourceRows.map((r) => [r.submissionId, r.role]));
  const sources = subs
    .map((s) => ({
      id: s.id,
      title: s.title,
      storyType: s.storyType,
      role: roleOf.get(s.id) ?? "SUPPORTING",
      contributorName: s.contributor ? `${s.contributor.firstName} ${s.contributor.lastName}`.trim() : null,
      contributorType: s.contributor?.type ?? null,
      excerpt: s.description ? s.description.slice(0, 220) : null,
      createdAt: s.createdAt,
    }))
    .sort((a, b) => Number(b.role === "PRIMARY") - Number(a.role === "PRIMARY") || a.title.localeCompare(b.title));

  // All sections of the edition, so an editor can move the story from inside the editor.
  const sectionList = await db.query.editionSections.findMany({ where: eq(editionSections.editionId, article.editionId), columns: { id: true, name: true }, orderBy: [asc(editionSections.sortOrder)] });

  return {
    article,
    story: { ...story, campusNames: story.campuses.map((c) => c.campus.name) },
    edition,
    sections: sectionList,
    sources,
    revisions: revisionRows.map((r) => ({ version: r.version, createdAt: r.createdAt, createdByAi: r.createdByAi, createdByName: r.createdBy?.name ?? null, changeSummary: r.changeSummary, wordCount: r.wordCount })),
    comments: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, userName: c.user?.name ?? null })),
    facts: storyFacts,
    quotes: storyQuotes,
    disputedFacts: storyFacts.filter((f) => f.status === "DISPUTED").length,
  };
}
