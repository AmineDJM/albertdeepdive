import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { ArticleBlock } from "@/lib/publication/document";
import { NotFoundError } from "@/lib/action-result";
import { audit } from "@/server/audit";
import { invalidateFlatplanLayout } from "@/server/publication/flatplan";
import type { EditionOperation } from "./operations";

/** What a batch of operations can reach, so only that much is kept. */
function touches(ops: EditionOperation[]): { plan: boolean; extent: boolean; articleIds: string[] } {
  const articleIds = new Set<string>();
  let plan = false;
  let extent = false;
  for (const op of ops) {
    switch (op.kind) {
      case "regenerate_layout":
      case "copyfit":
      case "add_picture_page":
      case "set_page_template":
      case "move_page":
      case "add_page":
      case "remove_page":
      case "set_page_story":
      case "set_page_notes":
        plan = true;
        break;
      case "set_extent":
        extent = true;
        plan = true; // the extent decides how the next plan is built
        break;
      case "remove_passage":
      case "shorten_article":
      case "expand_article":
      case "rewrite_headline":
      case "set_headline":
      case "set_standfirst":
        articleIds.add(op.articleId);
        break;
      default:
        break;
    }
  }
  return { plan, extent, articleIds: [...articleIds] };
}

type PlanPageSnapshot = typeof s.pagePlanPages.$inferSelect;

/**
 * Dates do not survive a round trip through jsonb.
 *
 * The rows go in as objects with `Date`s and come back with ISO strings, which the driver then
 * refuses to bind to a timestamp column. Restoring is the only place that puts a stored row back on
 * the table, so this is where they are made into dates again.
 */
function revive(page: PlanPageSnapshot): PlanPageSnapshot {
  const asDate = (v: unknown) => (v instanceof Date ? v : typeof v === "string" ? new Date(v) : new Date());
  return { ...page, createdAt: asDate(page.createdAt), updatedAt: asDate(page.updatedAt) };
}
type ArticleSnapshot = { id: string; headline: string; standfirst: string | null; body: ArticleBlock[]; wordCount: number };
type RestorePayload = {
  plan?: { planId: string; pages: PlanPageSnapshot[] };
  articles?: ArticleSnapshot[];
  extent?: { mode: string; pages: number };
};

/** Takes the smallest snapshot that can undo this batch. Returns null when there is nothing to keep. */
export async function createRestorePoint(
  editionId: string,
  ops: EditionOperation[],
  label: string,
  userId: string | null,
): Promise<string | null> {
  const reach = touches(ops);
  if (!reach.plan && !reach.extent && !reach.articleIds.length) return null;
  const payload: RestorePayload = {};

  if (reach.plan) {
    const plan = await db.query.pagePlans.findFirst({ where: and(eq(s.pagePlans.editionId, editionId), eq(s.pagePlans.isActive, true)) });
    if (plan) {
      const pages = await db.select().from(s.pagePlanPages).where(eq(s.pagePlanPages.planId, plan.id)).orderBy(asc(s.pagePlanPages.pageNumber));
      payload.plan = { planId: plan.id, pages };
    }
  }
  if (reach.extent) {
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    if (edition) payload.extent = { mode: edition.pageCountMode, pages: edition.targetPageCount };
  }
  if (reach.articleIds.length) {
    const rows = await db
      .select({ id: s.articles.id, headline: s.articles.headline, standfirst: s.articles.standfirst, body: s.articles.body, wordCount: s.articles.wordCount })
      .from(s.articles)
      .where(and(eq(s.articles.editionId, editionId), inArray(s.articles.id, reach.articleIds)));
    payload.articles = rows.map((r) => ({ id: r.id, headline: r.headline, standfirst: r.standfirst, body: r.body as ArticleBlock[], wordCount: r.wordCount }));
  }

  const org = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), columns: { organizationId: true } });
  const [row] = await db
    .insert(s.editionStudioRestorePoints)
    .values({ editionId, organizationId: org?.organizationId ?? null, label, payload: payload as Record<string, unknown>, createdById: userId })
    .returning({ id: s.editionStudioRestorePoints.id });
  return row.id;
}

/**
 * Puts the issue back the way it was.
 *
 * The page plan goes back row for row, which is why the whole plan is kept rather than a diff: a
 * re-plan renumbers everything, and a diff of that is a diff of the whole thing anyway. Articles go
 * back through a plain update rather than `saveArticle`, because restoring is not an edit — it
 * should not make a revision, change the status or reset an approval that the undone change is the
 * only reason to doubt.
 */
export async function restore(editionId: string, restorePointId: string, userId: string | null): Promise<{ label: string }> {
  const point = await db.query.editionStudioRestorePoints.findFirst({
    where: and(eq(s.editionStudioRestorePoints.id, restorePointId), eq(s.editionStudioRestorePoints.editionId, editionId)),
  });
  if (!point) throw new NotFoundError("Restore point");
  const payload = point.payload as RestorePayload;

  await db.transaction(async (tx) => {
    if (payload.plan) {
      await tx.delete(s.pagePlanPages).where(eq(s.pagePlanPages.planId, payload.plan.planId));
      if (payload.plan.pages.length) await tx.insert(s.pagePlanPages).values(payload.plan.pages.map(revive));
      await tx.update(s.pagePlans).set({ pageCount: payload.plan.pages.length, updatedAt: new Date() }).where(eq(s.pagePlans.id, payload.plan.planId));
    }
    if (payload.extent) {
      await tx.update(s.editions).set({ pageCountMode: payload.extent.mode, targetPageCount: payload.extent.pages }).where(eq(s.editions.id, editionId));
    }
    for (const a of payload.articles ?? []) {
      await tx.update(s.articles).set({ headline: a.headline, standfirst: a.standfirst, body: a.body, wordCount: a.wordCount }).where(eq(s.articles.id, a.id));
    }
  });

  await db.update(s.editionStudioRestorePoints).set({ restoredAt: new Date() }).where(eq(s.editionStudioRestorePoints.id, restorePointId));
  invalidateFlatplanLayout(editionId);
  await audit({ action: "studio.undo", userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { restorePointId, label: point.label } });
  return { label: point.label };
}
