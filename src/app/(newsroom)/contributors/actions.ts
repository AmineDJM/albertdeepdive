"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { anonymiseContributor, contributorInputSchema, createContributor, createGroup, deleteContributors, deleteGroup, groupInputSchema, setContributorActive, setContributorsActive, updateContributor } from "@/server/contributors/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { z } from "zod";
import { getUi } from "@/server/i18n/locale";

export async function createContributorAction(input: z.input<typeof contributorInputSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("contributor:manage");
    const row = await createContributor(input, user.id);
    revalidatePath("/contributors");
    return ok({ id: row.id }, `${row.firstName} ${row.lastName} added`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateContributorAction(id: string, patch: Partial<z.input<typeof contributorInputSchema>>): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("contributor:manage");
    await updateContributor(id, patch, user.id);
    revalidatePath("/contributors");
    revalidatePath(`/contributors/${id}`);
    return ok(null, tr("Contributor updated"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setContributorActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("contributor:manage");
    await setContributorActive(id, isActive, user.id);
    revalidatePath("/contributors");
    return ok(null, isActive ? "Contributor activated" : "Contributor deactivated");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function anonymiseContributorAction(id: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    await anonymiseContributor(id, user.id);
    revalidatePath("/contributors");
    return ok(null, tr("Personal data removed"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function createGroupAction(input: z.input<typeof groupInputSchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("contributor:manage");
    const row = await createGroup(input, user.id);
    revalidatePath("/contributors");
    return ok({ id: row.id }, `Group ${row.name} created`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function deleteGroupAction(id: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("contributor:manage");
    await deleteGroup(id, user.id);
    revalidatePath("/contributors");
    return ok(null, tr("Group deleted"));
  } catch (err) {
    return toActionFailure(err);
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export async function setContributorsActiveAction(ids: string[], isActive: boolean): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requirePermission("contributor:manage");
    const count = await setContributorsActive(ids, isActive, user.id);
    revalidatePath("/contributors");
    return ok({ count }, isActive ? `${plural(count, "contributor")} shown again` : `${plural(count, "contributor")} hidden`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function deleteContributorsAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requirePermission("contributor:manage");
    const count = await deleteContributors(ids, user.id);
    revalidatePath("/contributors");
    return ok({ count }, `${plural(count, "contributor")} deleted`);
  } catch (err) {
    return toActionFailure(err);
  }
}
