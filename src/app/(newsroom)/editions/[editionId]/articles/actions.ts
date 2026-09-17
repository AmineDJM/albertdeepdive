"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { createBlankStory } from "@/server/editorial/stories";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

/**
 * Creates a hand-authored article from scratch (a new story + an empty article shell) so an editor
 * can write something that did not come from a contributor's submission. Returns the new article id
 * to open in the workbench.
 */
export async function createArticleAction(editionId: string, input: { title: string; sectionId?: string | null; storyType?: string }): Promise<ActionResult<{ articleId: string }>> {
  try {
    const user = await requirePermission("article:edit");
    const { articleId } = await createBlankStory(editionId, { title: input.title, sectionId: input.sectionId ?? null, storyType: input.storyType }, user.id);
    revalidatePath(`/editions/${editionId}/articles`);
    revalidatePath(`/editions/${editionId}/stories`);
    revalidatePath(`/editions/${editionId}`);
    return ok({ articleId }, "Article created — opening the editor");
  } catch (err) {
    return toActionFailure(err);
  }
}
