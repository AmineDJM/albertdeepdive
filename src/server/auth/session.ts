import { cache } from "react";
import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { env } from "@/server/env";
import { generateOpaqueToken, hashIp, hashToken } from "./tokens";
import { type Permission, type Role, roleHasPermission } from "@/lib/auth/permissions";
import { ForbiddenError, UnauthorizedError } from "@/lib/action-result";

export const SESSION_COOKIE = "add_session";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  campusId: string | null;
  avatarUrl: string | null;
  permissions: readonly Permission[];
};

function sessionTtlMs() {
  return env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export async function createSession(userId: string, meta?: { userAgent?: string | null; ip?: string | null }) {
  const { token, hash } = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await db.insert(sessions).values({
    tokenHash: hash,
    userId,
    expiresAt,
    userAgent: meta?.userAgent?.slice(0, 300) ?? null,
    ipHash: hashIp(meta?.ip),
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function destroySession(token: string | undefined) {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function destroyAllUserSessions(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

async function loadUserFromToken(token: string | undefined): Promise<CurrentUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      campusId: users.campusId,
      avatarUrl: users.avatarUrl,
      isActive: users.isActive,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || !row.isActive) return null;
  const { permissionsForRole } = await import("@/lib/auth/permissions");
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    campusId: row.campusId,
    avatarUrl: row.avatarUrl,
    permissions: permissionsForRole(row.role),
  };
}

/** Per-request memoised current user (React cache). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  return loadUserFromToken(store.get(SESSION_COOKIE)?.value);
});

export async function getUserFromRequest(request: Request): Promise<CurrentUser | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const token = match?.slice(SESSION_COOKIE.length + 1);
  return loadUserFromToken(token ? decodeURIComponent(token) : undefined);
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requirePermission(permission: Permission | Permission[]): Promise<CurrentUser> {
  const user = await requireUser();
  const list = Array.isArray(permission) ? permission : [permission];
  if (!list.some((p) => roleHasPermission(user.role, p))) {
    throw new ForbiddenError(`Missing permission: ${list.join(" or ")}`);
  }
  return user;
}

export function hasPermission(user: CurrentUser | null | undefined, permission: Permission) {
  return !!user && roleHasPermission(user.role, permission);
}

export async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get("user-agent"),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
  };
}

/** Basic same-origin guard for mutating route handlers (server actions already enforce origin). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new URL(env.NEXT_PUBLIC_APP_URL).origin;
  const host = request.headers.get("host");
  if (origin !== allowed && (!host || new URL(origin).host !== host)) {
    throw new ForbiddenError("Cross-origin request rejected");
  }
}
