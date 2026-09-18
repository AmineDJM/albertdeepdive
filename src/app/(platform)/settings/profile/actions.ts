"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireUser, SESSION_COOKIE } from "@/server/auth/session";
import { changeOwnPassword, passwordChangeSchema, profileSchema, setExperiencePreference, setThemePreference, signOutOtherSessions, updateOwnProfile, type ThemePreference } from "@/server/settings/users";
import { isExperienceMode, type ExperienceMode } from "@/lib/experience";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { z } from "zod";
import { getUi } from "@/server/i18n/locale";

async function currentToken() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function updateProfileAction(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requireUser();
    await updateOwnProfile(user.id, input);
    revalidatePath("/settings/profile");
    revalidatePath("/", "layout");
    return ok(null, tr("Profile updated"));
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

/**
 * Standard or Advanced, for this person. The whole interface follows — sidebar, settings, the
 * rooms of an edition — and nothing about the workspace changes with it.
 */
export async function setExperienceAction(mode: ExperienceMode): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requireUser();
    if (!isExperienceMode(mode)) throw new Error("Unknown experience");
    await setExperiencePreference(user.id, mode);
    revalidatePath("/", "layout");
    return ok(null, mode === "advanced" ? tr("Advanced mode is on. Every door is open.") : tr("Standard mode is on. Only what matters is shown."));
  } catch (err) {
    return toActionFailure(err);
  }
}
