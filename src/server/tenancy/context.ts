import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
 *
 * Platform staff are the exception that proves the rule: they belong to no customer, so nothing is
 * resolved for them by default. They land on the console, and a customer's workspace opens only when
 * they ask for it by name — flagged, audited, and with a way back out.
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
  locale: string;
  timezone: string;
  role: OrganizationRole;
  isDefault: boolean;
};

type Staff = Pick<CurrentUser, "role" | "viewingAs">;

/**
 * Platform staff, by their real role.
 *
 * "View as" narrows the role a super admin *acts* with, and every permission check should honour
 * that. Which workspace they are standing in is a different question: a support session that opens
 * a customer's newsroom as one of its editors is still a staff member inside that customer, and must
 * not be thrown out of it the moment the simulated role forgets who they really are.
 */
function isPlatformStaff(user: Staff): boolean {
  return (user.viewingAs?.realRole ?? user.role) === "SUPER_ADMIN";
}

async function loadMemberships(userId: string): Promise<MembershipSummary[]> {
  const rows = await db
    .select({
      organizationId: organizations.id,
      slug: organizations.slug,
      name: organizations.name,
      locale: organizations.locale,
      timezone: organizations.timezone,
      role: organizationMembers.role,
      isDefault: organizationMembers.isDefault,
      status: organizations.status,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(asc(organizations.name));
  return rows
    .filter((r) => r.status !== "ARCHIVED")
    .map((r) => ({ organizationId: r.organizationId, slug: r.slug, name: r.name, locale: r.locale, timezone: r.timezone, role: r.role, isDefault: r.isDefault }));
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

function memberContext(membership: MembershipSummary): TenantContext {
  return { organizationId: membership.organizationId, slug: membership.slug, name: membership.name, locale: membership.locale, timezone: membership.timezone, role: membership.role, impersonated: false };
}

async function resolveFor(user: CurrentUser, requested: string | undefined): Promise<TenantContext | null> {
  const memberships = await loadMemberships(user.id);
  const asked = requested ? memberships.find((m) => m.organizationId === requested) : undefined;
  if (asked) return memberContext(asked);

  // Platform staff can open any workspace to support it — but only one they asked for by name, and
  // it is flagged so the UI can say so and the audit trail can record it. Nothing opens by default:
  // the people who run the platform have no newsroom of their own, and landing them in the first
  // customer's would make that customer look like part of Briefly.
  if (requested && isPlatformStaff(user)) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, requested) });
    if (org) {
      return { organizationId: org.id, slug: org.slug, name: org.name, locale: org.locale, timezone: org.timezone, role: "OWNER", impersonated: true };
    }
  }

  // A cookie pointing nowhere useful — a workspace the person left, or one that was archived —
  // falls back to the membership they would get with no cookie at all.
  const fallback = memberships.find((m) => m.isDefault) ?? memberships[0];
  return fallback ? memberContext(fallback) : null;
}

/** The signed-in user, or null — including where `cookies()` throws because there is no request. */
async function signedInUser(): Promise<CurrentUser | null> {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
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

const signedInWithoutTenant = cache(async (): Promise<boolean> => {
  const user = await signedInUser();
  if (!user) return false;
  return (await getTenant()) === null;
});

/**
 * True when somebody is signed in and looking at the app with no workspace in scope: platform staff
 * on the console, or a newcomer who has not created one yet.
 *
 * The scoping helpers need the distinction because, to them, this looks exactly like a background
 * job with no workspace declared — and a job may read every row while a person with no workspace
 * must see none.
 */
export async function withoutWorkspace(): Promise<boolean> {
  if (ambientOrganizationId()) return false;
  return signedInWithoutTenant();
}

/** Where a signed-in person with no workspace belongs: staff on the console, anyone else creating one. */
export function homeWithoutWorkspace(user: Staff): string {
  return isPlatformStaff(user) ? "/admin" : "/onboarding";
}

/**
 * The first screen after signing in.
 *
 * A member of a workspace gets the newsroom. Platform staff who belong to none get the console —
 * not a customer's newsroom, which is not theirs and would make that customer look like the product.
 */
export async function homeFor(user: Pick<CurrentUser, "id"> & Staff): Promise<string> {
  if ((await loadMemberships(user.id)).length) return "/overview";
  return homeWithoutWorkspace(user);
}

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
  if (tenant) return tenant;
  // A signed-in person with no workspace is sent where they belong rather than shown an error;
  // anything else asking — a job with nothing declared — is a bug worth a loud answer.
  const user = await signedInUser();
  if (user) redirect(homeWithoutWorkspace(user));
  throw new NotFoundError("Workspace");
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
  const allowed = memberships.some((m) => m.organizationId === organizationId) || isPlatformStaff(user);
  if (!allowed) throw new ForbiddenError("Not a member of that workspace");
  const store = await cookies();
  store.set(ORG_COOKIE, organizationId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

/**
 * Forget the workspace in scope.
 *
 * The next request resolves afresh: a member lands in their default workspace, platform staff on
 * the console. It is how staff leave a customer's newsroom, and it is harmless for anyone else.
 */
export async function clearActiveOrganization() {
  const store = await cookies();
  store.set(ORG_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
