"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireUser, destroySession, clearSessionCookie, SESSION_COOKIE } from "@/server/auth/session";
import { globalSearch } from "@/server/search/service";
import { markAllNotificationsRead, markNotificationRead } from "@/server/editions/notifications";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { audit } from "@/server/audit";

export async function searchAction(query: string): Promise<ActionResult<Awaited<ReturnType<typeof globalSearch>>>> {
  try {
    await requireUser();
    return ok(await globalSearch(String(query ?? "").slice(0, 120)));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function markNotificationReadAction(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await markNotificationRead(user.id, id);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await markAllNotificationsRead(user.id);
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function signOutAction() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const user = await requireUser().catch(() => null);
  await destroySession(token);
  await clearSessionCookie();
  if (user) await audit({ action: "auth.logout", userId: user.id, entityType: "USER", entityId: user.id });
  redirect("/login");
}
