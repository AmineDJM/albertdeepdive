"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { approveArticle, lockArticle, requestChanges, restoreRevision, runArticleAction, saveArticle, submitForReview, unlockArticle, type ArticleAction, type ArticlePatch, type ArticleProposal } from "@/server/editorial/articles";
import { explainBlock, type BlockExplanation } from "@/server/editorial/facts";
import { addComment } from "@/server/editorial/comments";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

function revalidateArticle(articleId: string, editionId?: string, storyId?: string) {
  revalidatePath(`/articles/${articleId}`);
  if (storyId) revalidatePath(`/stories/${storyId}`);
  if (editionId) {
    revalidatePath(`/editions/${editionId}/articles`);
    revalidatePath(`/editions/${editionId}/stories`);
  }
}

export async function saveArticleAction(articleId: string, patch: ArticlePatch, ctx: { editionId?: string; storyId?: string } = {}): Promise<ActionResult<{ revision: number; wordCount: number }>> {
  try {
    const user = await requirePermission("article:edit");
    const saved = await saveArticle(articleId, patch, user.id);
    revalidateArticle(articleId, ctx.editionId, ctx.storyId);
    return ok({ revision: saved.article.currentRevision, wordCount: saved.article.wordCount }, `Saved as revision ${saved.article.currentRevision}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Runs an explicit assistant action. It always returns a PROPOSAL; nothing is written. */
export async function runArticleActionAction(articleId: string, action: ArticleAction, options: { instruction?: string; targetWords?: number; targetLanguage?: "en" | "fr"; count?: number } = {}): Promise<ActionResult<ArticleProposal>> {
  try {
    const user = await requirePermission("ai:run");
    const proposal = await runArticleAction(articleId, action, user.id, options);
    if (action === "check_consistency" || action === "check_house_style") revalidateArticle(articleId);
    return ok(proposal);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function explainBlockAction(articleId: string, blockId: string): Promise<ActionResult<BlockExplanation>> {
  try {
    await requirePermission("edition:view");
    return ok(await explainBlock(articleId, blockId));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function submitForReviewAction(articleId: string, ctx: { editionId?: string; storyId?: string } = {}): Promise<ActionResult> {
  try {
    const user = await requirePermission("article:edit");
    await submitForReview(articleId, user.id);
    revalidateArticle(articleId, ctx.editionId, ctx.storyId);
    return ok(null, "Sent for review");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function approveArticleAction(articleId: string, options: { force?: boolean; reason?: string } = {}, ctx: { editionId?: string; storyId?: string } = {}): Promise<ActionResult> {
  try {
    const user = await requirePermission("article:approve");
    await approveArticle(articleId, user.id, { force: options.force, reason: options.reason ?? null });
    revalidateArticle(articleId, ctx.editionId, ctx.storyId);
    return ok(null, "Article approved");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function requestChangesAction(articleId: string, note: string, ctx: { editionId?: string; storyId?: string } = {}): Promise<ActionResult> {
  try {
    const user = await requirePermission("article:approve");
    await requestChanges(articleId, user.id, note);
    revalidateArticle(articleId, ctx.editionId, ctx.storyId);
    return ok(null, "Changes requested");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function restoreRevisionAction(articleId: string, version: number, ctx: { editionId?: string; storyId?: string } = {}): Promise<ActionResult> {
  try {
    const user = await requirePermission("article:edit");
    await restoreRevision(articleId, version, user.id);
    revalidateArticle(articleId, ctx.editionId, ctx.storyId);
    return ok(null, `Revision ${version} restored`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function toggleLockAction(articleId: string, lock: boolean, reason?: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("article:approve");
    if (lock) await lockArticle(articleId, user.id);
    else await unlockArticle(articleId, user.id, reason ?? null);
    revalidateArticle(articleId);
    return ok(null, lock ? "Article locked" : "Article unlocked");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function commentOnArticleAction(articleId: string, editionId: string, body: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("article:edit");
    await addComment("ARTICLE", articleId, body, user.id, editionId);
    revalidateArticle(articleId);
    return ok(null, "Note added");
  } catch (err) {
    return toActionFailure(err);
  }
}
