import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { organizationMembers, organizations } from "@/server/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/action-result";
import { getCurrentUser, type CurrentUser } from "@/server/auth/session";

/**
 * Tenant context.
 *
 * Every read and every write happens inside one workspace. The id is resolved here, on the server,
 * from the signed-in user's memberships — never from a request body, a query string or a header, so
 * a client cannot reach another customer's data by guessing an id.
 *
 * A user who belongs to several workspaces picks one; the choice is remembered in a cookie, but the
 * cookie is only ever a *hint*: it is checked against the membership table on every request, and a
 * value pointing anywhere else falls back to the default membership.
 */

export const ORG_COOKIE = "briefly_org";

/**
 * An explicit workspace for code that runs outside a request.
 *
 * A job worker picks up work for one customer at a time and has no cookie to read, so it declares
 * the workspace it is acting for and every scoped query below it picks it up automatically. It is
 * ambient rather than a parameter because the alternative is threading an id through every service
 * signature in the codebase — which is exactly the kind of thing one caller eventually forgets.
 */
const ambient = new AsyncLocalStorage<string>();

export function runAsOrganization<T>(organizationId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return ambient.run(organizationId, fn);
}

export function ambientOrganizationId(): string | undefined {
  return ambient.getStore();
}

export type OrganizationRole = "OWNER" | "ADMIN" | "EDITOR" | "CONTRIBUTOR" | "VIEWER";

export type TenantContext = {
  organizationId: string;
  slug: string;
  name: string;
  locale: string;
  timezone: string;
  /** The signed-in user's role *inside this workspace*. */
  role: OrganizationRole;
  /** True when the user reached this workspace through platform staff access, not a membership. */
  impersonated: boolean;
};

export type MembershipSummary = {
  organizationId: string;
  slug: string;
  name: string;
  role: OrganizationRole;
  isDefault: boolean;
};

async function loadMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await db
    .select({
      organizationId: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      role: organizationMembers.role,
      isDefault: organizationMembers.isDefault,
      status: organizations.status,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizations.name));
  return rows.filter((r) => r.status !== "ARCHIVED").map((r) => ({ organizationId: r.organizationId, slug: r.slug, name: r.name, role: r.role, isDefault: r.isDefault }));
}

/**
 * The organisations a given user belongs to, by id.
 *
 * For callers that hold a user but no request scope — a route handler that authenticated from the
 * cookie header itself, or a test invoking one directly — where `cookies()` would throw and the
 * memoised `getTenant` would quietly answer null. Membership is the question the file route asks:
 * not "which workspace is open" but "is this one of yours at all".
 */
export async function organizationIdsForUser(userId: string): Promise<string[]> {
  return (await loadMemberships(userId)).map((membership) => membership.organizationId);
}

/** Every workspace the signed-in user can open, for the switcher. */
export const listMyOrganizations = cache(async (): Promise<MembershipSummary[]> => {
  const user = await getCurrentUser();
  if (!user) return [];
  return loadMemberships(user.id);
});

async function resolveFor(user: CurrentUser, requested: string | undefined): Promise<TenantContext | null> {
  const memberships = await loadMemberships(user.id);
  const chosen = (requested && memberships.find((m) => m.organizationId === requested)) || memberships.find((m) => m.isDefault) || memberships[0];

  if (chosen) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, chosen.organizationId) });
    if (org) {
      return { organizationId: org.id, slug: org.slug, name: org.name, locale: org.locale, timezone: org.timezone, role: chosen.role, impersonated: false };
    }
  }

  // Platform staff can open any workspace to support it — but only by asking for it explicitly,
  // and it is flagged so the UI can say so and the audit trail can record it.
  if (user.role === "SUPER_ADMIN") {
    const org = requested
      ? await db.query.organizations.findFirst({ where: eq(organizations.id, requested) })
      : await db.query.organizations.findFirst({ orderBy: [asc(organizations.createdAt)] });
    if (org) {
      return { organizationId: org.id, slug: org.slug, name: org.name, locale: org.locale, timezone: org.timezone, role: "OWNER", impersonated: true };
    }
  }

  return null;
}

/**
 * Per-request memoised tenant context, or null when there is no workspace in scope.
 *
 * Null is a normal answer, not a failure: background jobs, the migration CLI and the public
 * contribution form all run outside a request, where `cookies()` throws. Those callers reach the
 * database through explicit ids instead, so they read null and skip scoping rather than crash.
 */
export const getTenant = cache(async (): Promise<TenantContext | null> => {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const store = await cookies();
    return await resolveFor(user, store.get(ORG_COOKIE)?.value);
  } catch {
    return null;
  }
});

/** The workspace a page or action is looking at, including an ambient one declared by a job. */
async function activeOrganizationId(): Promise<string | null> {
  const declared = ambientOrganizationId();
  if (declared) return declared;
  return (await getTenant())?.organizationId ?? null;
}

export async function requireTenant(): Promise<TenantContext> {
  const declared = ambientOrganizationId();
  if (declared) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, declared) });
    if (!org) throw new NotFoundError("Workspace");
    return { organizationId: org.id, slug: org.slug, name: org.name, locale: org.locale, timezone: org.timezone, role: "OWNER", impersonated: false };
  }
  const tenant = await getTenant();
  if (!tenant) throw new NotFoundError("Workspace");
  return tenant;
}

/** The active workspace id — the value every scoped query filters on. */
export async function currentOrganizationId(): Promise<string> {
  return (await requireTenant()).organizationId;
}

/** Same, but tolerant: background jobs and public token routes run without a session. */
export async function optionalOrganizationId(): Promise<string | null> {
  return activeOrganizationId();
}

const RANK: Record<OrganizationRole, number> = { OWNER: 5, ADMIN: 4, EDITOR: 3, CONTRIBUTOR: 2, VIEWER: 1 };

/** Workspace-level authority, orthogonal to the platform `Permission` checks. */
export async function requireOrganizationRole(minimum: OrganizationRole): Promise<TenantContext> {
  const tenant = await requireTenant();
  if (RANK[tenant.role] < RANK[minimum]) throw new ForbiddenError(`Requires ${minimum} in this workspace`);
  return tenant;
}

export async function setActiveOrganization(organizationId: string) {
  const user = await getCurrentUser();
  if (!user) throw new ForbiddenError("Not signed in");
  const memberships = await loadMemberships(user.id);
  const allowed = memberships.some((m) => m.organizationId === organizationId) || user.role === "SUPER_ADMIN";
  if (!allowed) throw new ForbiddenError("Not a member of that workspace");
  const store = await cookies();
  store.set(ORG_COOKIE, organizationId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}
