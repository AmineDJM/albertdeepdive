"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { activatePromptVersion, promptTestSchema, renderPromptTest, restorePromptDefault, savePromptVersion, type PromptVersionInput } from "@/server/settings/prompts";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { z } from "zod";

function revalidate(key: string) {
  revalidatePath("/settings/prompts");
  revalidatePath(`/settings/prompts/${key}`);
}

export async function savePromptVersionAction(key: string, input: PromptVersionInput): Promise<ActionResult<{ version: number }>> {
  try {
    const user = await requirePermission("prompt:manage");
    const row = await savePromptVersion(key, input, user.id);
    revalidate(key);
    return ok({ version: row.version }, `Version ${row.version} saved and activated`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function activatePromptVersionAction(key: string, version: number): Promise<ActionResult> {
  try {
    const user = await requirePermission("prompt:manage");
    await activatePromptVersion(key, version, user.id);
    revalidate(key);
    return ok(null, `Version ${version} is now active`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function restorePromptDefaultAction(key: string): Promise<ActionResult<{ version: number }>> {
  try {
    const user = await requirePermission("prompt:manage");
    const row = await restorePromptDefault(key, user.id);
    revalidate(key);
    return ok({ version: row.version }, `Default restored as version ${row.version}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function testPromptAction(input: z.input<typeof promptTestSchema>): Promise<ActionResult<ReturnType<typeof renderPromptTest>>> {
  try {
    await requirePermission("prompt:manage");
    return ok(renderPromptTest(input));
  } catch (err) {
    return toActionFailure(err);
  }
}
