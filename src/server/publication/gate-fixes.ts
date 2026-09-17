import { and, desc, eq, notInArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { articles, editions, mediaAssets, stories, storyMedia } from "@/server/db/schema";
import { approveArticle } from "@/server/editorial/articles";
import { setCoverStory } from "@/server/editorial/stories";
import { regeneratePagePlan, setPlanStatus } from "@/server/publication/flatplan";
import { createPublicationVersion, renderVersion } from "@/server/publication/versions";
import { kindForEditionStatus } from "@/server/publication/validate";
import { bulkSetRights, type MediaActor } from "@/server/media/rights";
import { updateEdition } from "@/server/editions/service";
import { createLogger } from "@/server/logger";
import { NotFoundError } from "@/lib/action-result";

const log = createLogger("publication:gate-fixes");

type Actor = MediaActor;

const FIX_REASON = "Fixed from the publication checklist";

/** Approves every non-approved article that has a headline and a body (forced, so disputed facts don't block). */
export async function approveAllArticles(editionId: string, user: Actor): Promise<number> {
  const rows = await db.query.articles.findMany({
    where: and(eq(articles.editionId, editionId), notInArray(articles.status, ["APPROVED", "LOCKED", "EMPTY"])),
    columns: { id: true, headline: true, body: true },
  });
  let approved = 0;
  for (const a of rows) {
    if (!a.headline.trim() || !a.body.length) continue;
    try {
      await approveArticle(a.id, user.id, { force: true, reason: FIX_REASON });
      approved += 1;
    } catch (err) {
      log.warn("gate-fix approve skipped", { articleId: a.id, err });
    }
  }
  return approved;
}

/** Marks every unclear (YELLOW) image in the edition as validated (GREEN). */
export async function validateImageRights(editionId: string, user: Actor): Promise<number> {
  const yellow = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.editionId, editionId), eq(mediaAssets.rightsStatus, "YELLOW"), eq(mediaAssets.isArchived, false)));
  if (!yellow.length) return 0;
  const res = await bulkSetRights(yellow.map((y) => y.id), "GREEN", FIX_REASON, { id: user.id, role: user.role as never });
  return res.updated;
}

/** Picks the highest-priority approved story (preferring one with a hero photo) as the cover. */
export async function autoPickCover(editionId: string, user: Actor): Promise<string | null> {
  const approvedStories = await db.query.stories.findMany({
    where: and(eq(stories.editionId, editionId), eq(stories.status, "APPROVED")),
    orderBy: [desc(stories.priority)],
    columns: { id: true, title: true },
  });
  if (!approvedStories.length) return null;
  const heroes = await db.select({ storyId: storyMedia.storyId }).from(storyMedia).where(eq(storyMedia.role, "hero"));
  const withHero = new Set(heroes.map((h) => h.storyId));
  const cover = approvedStories.find((s) => withHero.has(s.id)) ?? approvedStories[0];
  await setCoverStory(editionId, cover.id, user.id);
  const art = await db.query.articles.findFirst({ where: eq(articles.storyId, cover.id), columns: { headline: true } });
  await updateEdition(editionId, { coverHeadline: (art?.headline || cover.title).slice(0, 200) }, user.id);
  return cover.title;
}

/** Rebuilds the page plan (renumbers pages, regenerates the contents) and signs it off as validated. */
export async function validateLayout(editionId: string, user: Actor): Promise<number> {
  await regeneratePagePlan(editionId, { userId: user.id });
  const res = await setPlanStatus(editionId, "VALIDATED", user.id);
  return res.pages;
}

/** Renders a fresh version, producing the PDF and DOCX (and a clean pagination pass). */
export async function generateExports(editionId: string, user: Actor): Promise<string> {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId), columns: { status: true } });
  if (!edition) throw new NotFoundError("Edition");
  const version = await createPublicationVersion(editionId, { kind: kindForEditionStatus(edition.status), userId: user.id });
  await renderVersion(version.id);
  return version.label;
}
