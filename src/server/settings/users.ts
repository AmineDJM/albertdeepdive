/**
 * Users & roles, and the current user's own profile.
 */
import { randomInt } from "node:crypto";
import { and, asc, count, desc, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { campuses, sessions, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { destroyAllUserSessions } from "@/server/auth/session";
import { hashToken } from "@/server/auth/tokens";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { ROLES } from "@/lib/auth/permissions";
import { onlySent } from "@/lib/zod-patch";
import { experienceOf, type ExperienceMode } from "@/lib/experience";

export const userInputSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(ROLES),
  campusId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
});
export type UserInput = z.infer<typeof userInputSchema>;

export const userPatchSchema = userInputSchema.partial().omit({ email: true });
export type UserPatch = z.infer<typeof userPatchSchema>;

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 16 readable characters (no 0/O, 1/l/I) grouped for reading aloud: xxxx-xxxx-xxxx-xxxx. */
export function generateTemporaryPassword(): string {
  const chars: string[] = [];
  for (let i = 0; i < 16; i += 1) chars.push(PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]);
  return chars.join("").replace(/(.{4})(?=.)/g, "$1-");
}

export async function listUsers() {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      campusId: users.campusId,
      campusName: campuses.name,
      campusColour: campuses.colour,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      activeSessions: sql<number>`(select count(*) from ${sessions} where ${sessions.userId} = ${users.id} and ${sessions.expiresAt} > now())`,
    })
    .from(users)
    .leftJoin(campuses, eq(campuses.id, users.campusId))
    .orderBy(desc(users.isActive), asc(users.name));
  return rows.map((r) => ({ ...r, activeSessions: Number(r.activeSessions) }));
}

export type UserListRow = Awaited<ReturnType<typeof listUsers>>[number];

/** Users allowed to be editor in chief of an edition. */
export async function listEditorCandidates() {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), sql`${users.role} in ('EDITOR_IN_CHIEF', 'SUPER_ADMIN')`))
    .orderBy(asc(users.name));
}

export async function createUser(raw: z.input<typeof userInputSchema>, actorId?: string | null) {
  const input = userInputSchema.parse(raw);
  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) throw new ValidationError("A user with this email already exists", { email: ["Already in use"] });
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const [row] = await db
    .insert(users)
    .values({ name: input.name, email: input.email, role: input.role, campusId: input.role === "CAMPUS_EDITOR" ? (input.campusId ?? null) : (input.campusId ?? null), isActive: input.isActive, passwordHash })
    .returning();
  await audit({ action: "user.create", userId: actorId, entityType: "USER", entityId: row.id, metadata: { email: row.email, role: row.role, campusId: row.campusId } });
  return { user: row, temporaryPassword };
}

export async function updateUser(id: string, raw: z.input<typeof userPatchSchema>, actorId?: string | null) {
  const patch = onlySent(userPatchSchema.parse(raw), raw);
  const current = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!current) throw new NotFoundError("User");
  if (actorId === id) {
    if (patch.role && patch.role !== current.role) throw new ValidationError("You cannot change your own role");
    if (patch.isActive === false) throw new ValidationError("You cannot deactivate your own account");
  }
  if (patch.role && patch.role !== "SUPER_ADMIN" && current.role === "SUPER_ADMIN") {
    const [{ n }] = await db.select({ n: count() }).from(users).where(and(eq(users.role, "SUPER_ADMIN"), eq(users.isActive, true), ne(users.id, id)));
    if (Number(n) === 0) throw new ValidationError("Keep at least one active super admin");
  }
  const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  const changed: Record<string, unknown> = {};
  if (patch.role && patch.role !== current.role) changed.role = { from: current.role, to: patch.role };
  if (patch.isActive !== undefined && patch.isActive !== current.isActive) changed.isActive = patch.isActive;
  if (patch.campusId !== undefined && patch.campusId !== current.campusId) changed.campusId = patch.campusId;
  if (patch.name && patch.name !== current.name) changed.name = patch.name;
  if (patch.isActive === false) await destroyAllUserSessions(id);
  await audit({ action: patch.isActive === false ? "user.deactivate" : changed.role ? "user.role_change" : "user.update", userId: actorId, entityType: "USER", entityId: id, metadata: { ...changed, email: current.email } });
  return row;
}

export async function resetUserPassword(id: string, actorId?: string | null) {
  const current = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!current) throw new NotFoundError("User");
  const temporaryPassword = generateTemporaryPassword();
  await db.update(users).set({ passwordHash: await hashPassword(temporaryPassword) }).where(eq(users.id, id));
  await destroyAllUserSessions(id);
  await audit({ action: "user.password_reset", userId: actorId, entityType: "USER", entityId: id, metadata: { email: current.email } });
  return { temporaryPassword };
}

// ── Own profile ─────────────────────────────────────────────────────────────

export type ThemePreference = "light" | "dark";

export async function getOwnProfile(userId: string, currentToken?: string | null) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), with: { campus: true } });
  if (!user) throw new NotFoundError("User");
  const currentHash = currentToken ? hashToken(currentToken) : null;
  const sessionRows = await db
    .select({ id: sessions.id, tokenHash: sessions.tokenHash, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastSeenAt));
  const prefs = (user.preferences ?? {}) as Record<string, unknown>;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    campus: user.campus ? { name: user.campus.name, colour: user.campus.colour } : null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    theme: (prefs.theme === "dark" ? "dark" : "light") as ThemePreference,
    experience: experienceOf(prefs),
    sessions: sessionRows.map((s) => ({ id: s.id, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, current: currentHash !== null && s.tokenHash === currentHash })),
  };
}

export const profileSchema = z.object({ name: z.string().trim().min(2, "Name is too short").max(80) });

export async function updateOwnProfile(userId: string, raw: z.input<typeof profileSchema>) {
  const input = profileSchema.parse(raw);
  const [row] = await db.update(users).set({ name: input.name }).where(eq(users.id, userId)).returning({ id: users.id, name: users.name });
  if (!row) throw new NotFoundError("User");
  await audit({ action: "user.profile_update", userId, entityType: "USER", entityId: userId, metadata: { fields: ["name"] } });
  return row;
}

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(10, "Use at least 10 characters").max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choose a different password" });

export async function changeOwnPassword(userId: string, raw: z.input<typeof passwordChangeSchema>, currentToken?: string | null) {
  const input = passwordChangeSchema.parse(raw);
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new NotFoundError("User");
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ValidationError("Current password is incorrect", { currentPassword: ["Incorrect password"] });
  }
  await db.update(users).set({ passwordHash: await hashPassword(input.newPassword) }).where(eq(users.id, userId));
  // Other devices must sign in again with the new password; the current session stays valid.
  const revoked = await signOutOtherSessions(userId, currentToken);
  await audit({ action: "user.password_change", userId, entityType: "USER", entityId: userId, metadata: { revokedSessions: revoked } });
  return { revokedSessions: revoked };
}

/** Deletes every session of the user except the one identified by `currentToken` (all of them when absent). */
export async function signOutOtherSessions(userId: string, currentToken?: string | null): Promise<number> {
  if (!currentToken) {
    const [{ n }] = await db.select({ n: count() }).from(sessions).where(eq(sessions.userId, userId));
    await destroyAllUserSessions(userId);
    return Number(n);
  }
  const rows = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(currentToken))))
    .returning({ id: sessions.id });
  await audit({ action: "user.sessions_revoke", userId, entityType: "USER", entityId: userId, metadata: { revokedSessions: rows.length } });
  return rows.length;
}

/** A person's own interface language, which wins over their workspace's. */
export async function setLocalePreference(userId: string, locale: "en" | "fr") {
  await db
    .update(users)
    .set({ preferences: sql`coalesce(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ locale })}::jsonb` })
    .where(eq(users.id, userId));
  return locale;
}

export async function setThemePreference(userId: string, theme: ThemePreference) {
  await db
    .update(users)
    .set({ preferences: sql`coalesce(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ theme })}::jsonb` })
    .where(eq(users.id, userId));
  return theme;
}

/**
 * Standard or Advanced, for this person on every workspace they open. Changes what is shown and
 * nothing else: no edition, brand, publication or setting is touched by switching.
 */
export async function setExperiencePreference(userId: string, experience: ExperienceMode) {
  await db
    .update(users)
    .set({ preferences: sql`coalesce(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ experience })}::jsonb` })
    .where(eq(users.id, userId));
  await audit({ action: "user.experience", userId, entityType: "USER", entityId: userId, metadata: { experience } });
}
