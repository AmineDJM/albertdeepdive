"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { createSession, requestMeta, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { fail, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

/**
 * Making an account, which until now was impossible.
 *
 * Every "Start for free" on the marketing site led to the sign-in page, which only opens a door for
 * people who already have a key. This is the missing half: it creates the person, signs them in and
 * hands them to onboarding, where they name their organisation.
 *
 * The new account is an editor in chief of nothing yet. The role is what they can do inside a
 * workspace once they have one, and the first thing onboarding does is make them its owner.
 */
const schema = z
  .object({
    name: z.string().trim().min(2, "Tell us your name").max(80),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    password: z.string().min(10, "At least 10 characters").max(200),
    confirm: z.string(),
    next: z.string().optional(),
  })
  .refine((v) => v.password === v.confirm, { message: "Both passwords have to match", path: ["confirm"] });

const attempts = new Map<string, { count: number; until: number }>();

/** A signup form is a spam target, so one address family gets a handful of tries and then waits. */
function throttled(key: string) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= 10;
}

function record(key: string) {
  const entry = attempts.get(key) ?? { count: 0, until: Date.now() + 15 * 60_000 };
  entry.count += 1;
  attempts.set(key, entry);
}

export async function signUpAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const tr = await getUi();
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = [tr(issue.message)];
    return fail(tr("Check the form"), { fieldErrors });
  }
  const { name, email, password, next } = parsed.data;
  const meta = await requestMeta();
  const key = meta.ip ?? "?";
  if (throttled(key)) return fail(tr("Too many attempts. Try again in a few minutes."));

  const existing = await db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true } });
  if (existing) {
    record(key);
    // Says the address is taken rather than pretending: this is a business tool, and somebody who
    // signed up last month and forgot needs to be sent to the sign-in page, not left guessing.
    return fail(tr("There is already an account with that address."), { fieldErrors: { email: [tr("Already registered — sign in instead.")] } });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ name, email, role: "EDITOR_IN_CHIEF", passwordHash, isActive: true }).returning();
  const { token, expiresAt } = await createSession(user.id, meta);
  await setSessionCookie(token, expiresAt);
  await audit({ action: "auth.signup", userId: user.id, entityType: "USER", entityId: user.id, metadata: { email } });
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/onboarding";
  redirect(target);
}
