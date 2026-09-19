import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { createLogger } from "@/server/logger";
import { audit } from "@/server/audit";
import { runArticleAction, saveArticle } from "@/server/editorial/articles";
import {
  addPlanPage,
  movePlanPage,
  regeneratePagePlan,
  removePlanPage,
  runCopyfitPass,
  setPageNotes,
  setPageStory,
  setPageTemplate,
} from "@/server/publication/flatplan";
import { updateEdition } from "@/server/editions/service";
import { summarise, type EditionOperation } from "./operations";

const log = createLogger("edition-studio");

export type OperationOutcome = {
  op: EditionOperation;
  ok: boolean;
  /** What actually happened, in facts the interface can show without dressing up. */
  detail: string;
  error?: string;
};

/**
 * The ids this edition owns.
 *
 * Loaded once per batch and checked before anything runs. The services underneath each do their own
 * check — `requirePlanPage` refuses a page from another issue, `saveArticle` loads by id — so this
 * is the second lock on the same door, and it is here on purpose: the operations arrive from a model
 * that has just read an issue full of words strangers sent in. A refusal here is a clean sentence in
 * the conversation rather than an exception from three layers down.
 */
type EditionScope = {
  articleIds: Set<string>;
  storyIds: Set<string>;
  pageIds: Set<string>;
};

async function loadScope(editionId: string): Promise<EditionScope> {
  const [articleRows, storyRows, planRows] = await Promise.all([
    db.select({ id: s.articles.id }).from(s.articles).where(eq(s.articles.editionId, editionId)),
    db.select({ id: s.stories.id }).from(s.stories).where(eq(s.stories.editionId, editionId)),
    db
      .select({ id: s.pagePlanPages.id })
      .from(s.pagePlanPages)
      .innerJoin(s.pagePlans, eq(s.pagePlans.id, s.pagePlanPages.planId))
      .where(and(eq(s.pagePlans.editionId, editionId), eq(s.pagePlans.isActive, true))),
  ]);
  return {
    articleIds: new Set(articleRows.map((r) => r.id)),
    storyIds: new Set(storyRows.map((r) => r.id)),
    pageIds: new Set(planRows.map((r) => r.id)),
  };
}

/** Photographs have to be this workspace's; the tenant scope decides, not the operation. */
async function ownedMedia(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: s.mediaAssets.id })
    .from(s.mediaAssets)
    .where(await scoped(s.mediaAssets.organizationId, inArray(s.mediaAssets.id, ids)));
  return rows.map((r) => r.id);
}

function checkScope(op: EditionOperation, scope: EditionScope) {
  const page = (id: string) => {
    if (!scope.pageIds.has(id)) throw new NotFoundError("Page");
  };
  const article = (id: string) => {
    if (!scope.articleIds.has(id)) throw new NotFoundError("Article");
  };
  const story = (id: string) => {
    if (!scope.storyIds.has(id)) throw new NotFoundError("Story");
  };
  switch (op.kind) {
    case "shorten_article":
    case "expand_article":
    case "rewrite_headline":
    case "set_headline":
    case "set_standfirst":
      return article(op.articleId);
    case "attach_photos":
      return story(op.storyId);
    case "add_picture_page":
      page(op.afterPageId);
      if (op.storyId) story(op.storyId);
      return;
    case "set_page_template":
    case "move_page":
    case "remove_page":
    case "set_page_notes":
      return page(op.pageId);
    case "set_page_story":
      page(op.pageId);
      if (op.storyId) story(op.storyId);
      return;
    case "add_page":
      if (op.afterPageId) page(op.afterPageId);
      return;
    default:
      return;
  }
}

/** Applies one operation by calling the service that already owns it. */
async function runOne(editionId: string, op: EditionOperation, userId: string): Promise<string> {
  switch (op.kind) {
    case "set_extent": {
      if (op.mode === "fixed" && !op.pages) throw new ValidationError("A fixed extent needs a page count");
      await updateEdition(editionId, { pageCountMode: op.mode, ...(op.pages ? { targetPageCount: op.pages } : {}) }, userId);
      return op.mode === "fixed" ? `The issue is now set to exactly ${op.pages} pages.` : `The page count is a ceiling of ${op.pages ?? "the current target"} again.`;
    }
    case "regenerate_layout": {
      const res = await regeneratePagePlan(editionId, { userId });
      return `Re-planned: ${res.pages} pages, ${res.locked} kept as they were.`;
    }
    case "copyfit": {
      const report = await runCopyfitPass(editionId, userId);
      return `Re-measured: ${report.pages} pages, ${report.continuationPagesAdded} jump page(s).`;
    }
    case "shorten_article":
    case "expand_article": {
      const action = op.kind === "shorten_article" ? "shorten" : "expand";
      const proposal = await runArticleAction(op.articleId, action, userId, { targetWords: op.targetWords });
      if (!proposal.blocks?.length) throw new ValidationError("The copy editor returned nothing to apply");
      const saved = await saveArticle(op.articleId, { body: proposal.blocks, changeSummary: summarise(op) }, userId);
      return `"${saved.article.headline}" is now ${saved.article.wordCount} words.${proposal.changes?.length ? ` ${proposal.changes[0]}` : ""}`;
    }
    case "rewrite_headline": {
      const proposal = await runArticleAction(op.articleId, "rewrite_headline", userId, { instruction: op.instruction });
      if (!proposal.headline) throw new ValidationError("No headline came back");
      const saved = await saveArticle(op.articleId, { headline: proposal.headline, changeSummary: summarise(op) }, userId);
      return `New headline: "${saved.article.headline}".`;
    }
    case "set_headline": {
      const saved = await saveArticle(op.articleId, { headline: op.headline, changeSummary: summarise(op) }, userId);
      return `Headline set to "${saved.article.headline}".`;
    }
    case "set_standfirst": {
      await saveArticle(op.articleId, { standfirst: op.standfirst, changeSummary: summarise(op) }, userId);
      return op.standfirst ? "Standfirst set." : "Standfirst cleared.";
    }
    case "attach_photos": {
      const owned = await ownedMedia(op.mediaIds);
      if (!owned.length) throw new NotFoundError("Photographs");
      const existing = await db.select({ id: s.storyMedia.mediaAssetId }).from(s.storyMedia).where(eq(s.storyMedia.storyId, op.storyId));
      const already = new Set(existing.map((r) => r.id));
      const fresh = owned.filter((id) => !already.has(id));
      if (fresh.length) {
        await db.insert(s.storyMedia).values(
          fresh.map((mediaAssetId, i) => ({ storyId: op.storyId, mediaAssetId, role: op.role ?? "gallery", sortOrder: already.size + i })),
        );
      }
      return `${fresh.length} photograph(s) added${already.size ? `, ${owned.length - fresh.length} were already there` : ""}.`;
    }
    case "add_picture_page": {
      const created = await addPlanPage(editionId, { afterPageId: op.afterPageId, template: "PHOTO_STORY", userId });
      if (op.storyId) await setPageStory(editionId, created.pageId, op.storyId, { userId });
      return `Picture page added; the issue is ${created.pages} pages.`;
    }
    case "set_page_template": {
      const res = await setPageTemplate(editionId, op.pageId, op.template, userId);
      return `Page ${res.pageNumber} is now a ${op.template} page.`;
    }
    case "move_page": {
      await movePlanPage(editionId, op.pageId, op.direction, userId);
      return `Page moved ${op.direction}.`;
    }
    case "add_page": {
      const created = await addPlanPage(editionId, { afterPageId: op.afterPageId, template: op.template ?? undefined, userId });
      return `Page added; the issue is ${created.pages} pages.`;
    }
    case "remove_page": {
      const res = await removePlanPage(editionId, op.pageId, userId);
      return `Page removed; the issue is ${res.pages} pages.`;
    }
    case "set_page_story": {
      const res = await setPageStory(editionId, op.pageId, op.storyId, { userId });
      return op.storyId ? `"${res.storyTitle}" is on page ${res.pageNumber}.` : `Page ${res.pageNumber} cleared.`;
    }
    case "set_page_notes": {
      const res = await setPageNotes(editionId, op.pageId, op.notes, userId);
      return op.notes ? `Note left on page ${res.pageNumber}.` : `Note cleared on page ${res.pageNumber}.`;
    }
  }
}

/**
 * Runs a batch, one operation at a time, and reports each outcome.
 *
 * One failing operation does not abandon the rest: each is independently meaningful, a restore point
 * was taken before the batch, and an editor would rather be told "three done, this one could not"
 * than have three good changes thrown away with the bad one.
 */
export async function executeOperations(editionId: string, ops: EditionOperation[], userId: string): Promise<OperationOutcome[]> {
  const scope = await loadScope(editionId);
  const outcomes: OperationOutcome[] = [];
  for (const op of ops) {
    try {
      checkScope(op, scope);
      const detail = await runOne(editionId, op, userId);
      await audit({ action: `studio.${op.kind}`, userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { operation: op, summary: summarise(op) } });
      outcomes.push({ op, ok: true, detail });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("studio operation refused", { editionId, kind: op.kind, error });
      outcomes.push({ op, ok: false, detail: "", error });
    }
  }
  return outcomes;
}
