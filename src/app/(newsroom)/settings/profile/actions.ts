"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireUser, SESSION_COOKIE } from "@/server/auth/session";
import { changeOwnPassword, passwordChangeSchema, profileSchema, setThemePreference, signOutOtherSessions, updateOwnProfile, type ThemePreference } from "@/server/settings/users";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { z } from "zod";

async function currentToken() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function updateProfileAction(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await updateOwnProfile(user.id, input);
    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
    return ok(null, "Profile updated");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function changePasswordAction(input: z.input<typeof passwordChangeSchema>): Promise<ActionResult<{ revokedSessions: number }>> {
  try {
    const user = await requireUser();
    const result = await changeOwnPassword(user.id, input, await currentToken());
    revalidatePath("/settings/profile");
    return ok(result, result.revokedSessions ? `Password changed · ${result.revokedSessions} other ${result.revokedSessions === 1 ? "session" : "sessions"} signed out` : "Password changed");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function signOutOtherSessionsAction(): Promise<ActionResult<{ revokedSessions: number }>> {
  try {
    const user = await requireUser();
    const revokedSessions = await signOutOtherSessions(user.id, await currentToken());
    revalidatePath("/settings/profile");
    return ok({ revokedSessions }, revokedSessions ? `${revokedSessions} other ${revokedSessions === 1 ? "session" : "sessions"} signed out` : "No other active sessions");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function setThemeAction(theme: ThemePreference): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await setThemePreference(user.id, theme === "dark" ? "dark" : "light");
    revalidatePath("/settings/profile");
    return ok(null, `Theme preference saved: ${theme}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Change the interface language for this person only. Their workspace keeps its own default. */
export async function setLocaleAction(locale: "en" | "fr"): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const { setLocalePreference } = await import("@/server/settings/users");
    await setLocalePreference(user.id, locale === "fr" ? "fr" : "en");
    revalidatePath("/", "layout");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
