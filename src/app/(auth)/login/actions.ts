"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { verifyPassword } from "@/server/auth/password";
import { createSession, requestMeta, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { fail, type ActionResult } from "@/lib/action-result";
import { NEWSROOM_ROLES } from "@/lib/auth/permissions";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

const attempts = new Map<string, { count: number; until: number }>();

function throttled(key: string) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= 8;
}

function recordFailure(key: string) {
  const entry = attempts.get(key) ?? { count: 0, until: Date.now() + 10 * 60_000 };
  entry.count += 1;
  attempts.set(key, entry);
}

export async function signInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password"), next: formData.get("next") ?? undefined });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = [issue.message];
    return fail("Check the form", { fieldErrors });
  }
  const { email, password, next } = parsed.data;
  const meta = await requestMeta();
  const key = `${email}:${meta.ip ?? "?"}`;
  if (throttled(key)) return fail("Too many attempts. Try again in a few minutes.");
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  const valid = user && user.isActive && (await verifyPassword(password, user.passwordHash));
  if (!valid) {
    recordFailure(key);
    await audit({ action: "auth.login_failed", metadata: { email }, actorType: "SYSTEM" });
    return fail("Incorrect email or password.");
  }
  if (!NEWSROOM_ROLES.includes(user.role)) return fail("Your account can submit stories but cannot access the newsroom.");
  const { token, expiresAt } = await createSession(user.id, meta);
  await setSessionCookie(token, expiresAt);
  await audit({ action: "auth.login", userId: user.id, entityType: "USER", entityId: user.id });
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview";
  redirect(target);
}
