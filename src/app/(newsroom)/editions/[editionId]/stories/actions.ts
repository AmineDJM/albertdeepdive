"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { assignSection, createStoriesForEdition, createStoryFromCluster, dropStory, rejectStory, selectStory, setCoverStory, updateStory, type StoryPatch } from "@/server/editorial/stories";
import { confirmCluster, dismissCluster, mergeClusters, splitCluster } from "@/server/editorial/clustering";
import { draftArticle } from "@/server/editorial/articles";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

function revalidateEdition(editionId: string) {
  revalidatePath(`/editions/${editionId}/stories`);
  revalidatePath(`/editions/${editionId}/articles`);
  revalidatePath(`/editions/${editionId}`);
}

export async function selectStoryAction(editionId: string, storyId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await selectStory(storyId, user.id);
    revalidateEdition(editionId);
    return ok(null, tr("Story selected for this issue"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function rejectStoryAction(editionId: string, storyId: string, reason?: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await rejectStory(storyId, user.id, reason ?? null);
    revalidateEdition(editionId);
    return ok(null, tr("Story rejected"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function dropStoryAction(editionId: string, storyId: string, reason?: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await dropStory(storyId, user.id, reason ?? null);
    revalidateEdition(editionId);
    return ok(null, tr("Story dropped from the issue"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function assignSectionAction(editionId: string, storyId: string, sectionId: string | null): Promise<ActionResult> {
  try {
    const user = await requirePermission("story:edit");
    await assignSection(storyId, sectionId, user.id);
    revalidateEdition(editionId);
    revalidatePath(`/stories/${storyId}`);
    return ok(null, sectionId ? "Section assigned" : "Section cleared");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setCoverStoryAction(editionId: string, storyId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("edition:edit");
    await setCoverStory(editionId, storyId, user.id);
    revalidateEdition(editionId);
    return ok(null, tr("Cover story set"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateStoryAction(editionId: string, storyId: string, patch: StoryPatch): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await updateStory(storyId, patch, user.id);
    revalidateEdition(editionId);
    revalidatePath(`/stories/${storyId}`);
    return ok(null, tr("Story updated"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function createStoryFromClusterAction(editionId: string, clusterId: string): Promise<ActionResult<{ id: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    const story = await createStoryFromCluster(clusterId, { userId: user.id });
    revalidateEdition(editionId);
    return ok({ id: story.id }, tr("Story created from the cluster"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function createAllStoriesAction(editionId: string): Promise<ActionResult<{ created: number }>> {
  try {
    const user = await requirePermission("story:edit");
    const result = await createStoriesForEdition(editionId, { userId: user.id });
    revalidateEdition(editionId);
    return ok({ created: result.created.length }, `${result.created.length} stories created`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function mergeClustersAction(editionId: string, clusterIds: string[], reason?: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await mergeClusters(clusterIds, user.id, { reason: reason ?? null });
    revalidateEdition(editionId);
    return ok(null, tr("Clusters merged"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function splitClusterAction(editionId: string, clusterId: string, submissionIds: string[], title?: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await splitCluster(clusterId, submissionIds, user.id, { title });
    revalidateEdition(editionId);
    return ok(null, tr("Cluster split"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function confirmClusterAction(editionId: string, clusterId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await confirmCluster(clusterId, user.id);
    revalidateEdition(editionId);
    return ok(null, tr("Cluster confirmed"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function dismissClusterAction(editionId: string, clusterId: string, reason?: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("story:edit");
    await dismissCluster(clusterId, user.id, reason ?? null);
    revalidateEdition(editionId);
    return ok(null, tr("Cluster dismissed"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function draftArticleAction(editionId: string, storyId: string): Promise<ActionResult<{ articleId: string; cautions: string[] }>> {
  try {
    const user = await requirePermission("article:edit");
    const result = await draftArticle(storyId, { userId: user.id });
    revalidateEdition(editionId);
    revalidatePath(`/stories/${storyId}`);
    return ok({ articleId: result.article.id, cautions: result.cautions }, `Draft written (${result.article.wordCount} words)`);
  } catch (err) {
    return toActionFailure(err);
  }
}
