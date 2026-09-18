"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/server/auth/session";
import { startViewAs, stopViewAs } from "@/server/auth/view-as";
import { setActiveOrganization } from "@/server/tenancy/context";
import { clearOverrides, setOverrides, setPlatformRole, setUserActive } from "@/server/platform/overrides";
import { audit } from "@/server/audit";
import { pruneGeneratedGrounds } from "@/server/creative/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { Role } from "@/lib/auth/permissions";

/**
 * Platform acts.
 *
 * Every one of these reaches across a tenant boundary, which nothing else in the product is allowed
 * to do, so every one of them is gated on `settings:manage` — the platform role, held only by Briefly
 * staff — and every one of them is recorded with the real actor's name.
 */

/**
 * Open a customer's workspace, optionally as one of their people.
 *
 * Two separate things, deliberately: the workspace cookie decides *whose data* you are looking at,
 * and the view-as cookie decides *which permissions* you hold while you look. Support usually wants
 * both — "show me what their campus editor sees" — but sometimes only the first, to fix something
 * with full rights.
 *
 * The role can only ever narrow, because only a super admin can call this and a super admin already
 * holds everything. The audit entry names the real person either way.
 */
export async function enterWorkspaceAction(organizationId: string, viewAs?: { role: Role; userId?: string; userName?: string }): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await setActiveOrganization(organizationId);
    if (viewAs) await startViewAs({ ...viewAs, organizationId });
    else await stopViewAs();
    await audit({
      action: "platform.enter",
      entityType: "SETTING",
      entityId: organizationId,
      organizationId,
      userId: user.id,
      metadata: { viewAs: viewAs ? `${viewAs.role}${viewAs.userName ? ` (${viewAs.userName})` : ""}` : null },
    });
  } catch (err) {
    return toActionFailure(err);
  }
  redirect("/overview");
}

/** Back to being yourself. Available from the banner, from anywhere. */
export async function leaveViewAsAction(): Promise<ActionResult> {
  try {
    await stopViewAs();
    revalidatePath("/", "layout");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setOverridesAction(organizationId: string, patch: Record<string, unknown>, reason?: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await setOverrides({ organizationId, patch, actorId: user.id, reason });
    revalidatePath("/platform/workspaces");
    return ok(null, "Saved");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function clearOverridesAction(organizationId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await clearOverrides(organizationId, user.id);
    revalidatePath("/platform/workspaces");
    return ok(null, "Back to the plan");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setPlatformRoleAction(userId: string, role: Role): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await setPlatformRole({ userId, role, actorId: user.id });
    revalidatePath("/platform/people");
    return ok(null, "Role changed");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setUserActiveAction(userId: string, isActive: boolean): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    await setUserActive({ userId, isActive, actorId: user.id });
    revalidatePath("/platform/people");
    return ok(null, isActive ? "Account restored" : "Account suspended");
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Remove generated grounds nothing refers to any more.
 *
 * A ground is content-addressed and shared between packs, so no pack owns it and deleting a pack
 * never removes one. It is the one kind of file in the bucket with no owner and no end, which makes
 * clearing it a platform act: the walk crosses every organisation's specs, and it is recorded as
 * such. The dry run is the same walk without the deletes, so the number on the button is the number.
 */
export async function pruneGroundsAction(dryRun: boolean): Promise<ActionResult<{ kept: number; removed: number; referenced: number }>> {
  try {
    const user = await requirePermission("settings:manage");
    const result = await pruneGeneratedGrounds({ dryRun });
    const count = result.removed.length;
    if (!dryRun) {
      await audit({
        action: "platform.prune_grounds",
        entityType: "SETTING",
        userId: user.id,
        metadata: { removed: count, kept: result.kept, referenced: result.referenced },
      });
      revalidatePath("/platform");
    }
    return ok(
      { kept: result.kept, removed: count, referenced: result.referenced },
      dryRun ? (count ? `${count} ground${count === 1 ? "" : "s"} nobody uses` : "Nothing to remove") : `${count} removed · ${result.kept} kept`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}
