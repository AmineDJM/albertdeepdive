import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { Entitlements } from "@/server/db/schema/billing";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { FALLBACK_ENTITLEMENTS, resolveEntitlements } from "@/server/billing/entitlements";
import { ROLES, type Role } from "@/lib/auth/permissions";

/**
 * Giving one customer something their plan does not include.
 *
 * Every SaaS ends up here. A university wants a fifth publication for one term; a design partner gets
 * the API a year before it is priced; somebody is migrating twelve thousand subscribers onto a plan
 * that caps at ten. The wrong answer is to invent a plan for each of them, because then pricing is a
 * list of exceptions and nobody can say what anything costs.
 *
 * So an override is a patch on top of the plan, stored against the subscription, and the plan itself
 * is untouched. Move that workspace to a different plan later and the overrides still apply — which
 * is the point, and also the thing to be careful about, so the console shows every override next to
 * the plan value it replaces rather than hiding it behind a number that silently disagrees.
 *
 * Nothing here is a UI convenience. `resolveEntitlements` already reads these, and every limit is
 * enforced on the server at the moment the thing is created.
 */

/** The limits a person can raise or lower. `null` means unlimited and is not the same as 0. */
export const LIMIT_KEYS = ["publications", "users", "subscribers", "editionsPerMonth"] as const;

/** The switches. Each is a capability the product genuinely gates on. */
export const FLAG_KEYS = [
  "customDomain",
  "removeBrieflyBranding",
  "approvalWorkflows",
  "advancedAnalytics",
  "apiAccess",
  "webhooks",
  "printFeatures",
] as const;

export const OVERRIDE_LABELS: Record<string, string> = {
  publications: "Publications",
  users: "Team members",
  subscribers: "Subscribers",
  editionsPerMonth: "Editions per month",
  customDomain: "Custom domain",
  removeBrieflyBranding: "No Briefly branding",
  approvalWorkflows: "Approval workflows",
  advancedAnalytics: "Advanced analytics",
  apiAccess: "API access",
  webhooks: "Webhooks",
  printFeatures: "Print delivery",
  outputs: "Formats",
};

export type OverrideRow = {
  key: string;
  label: string;
  kind: "limit" | "flag";
  planValue: number | boolean | null;
  effective: number | boolean | null;
  overridden: boolean;
};

/**
 * What this workspace gets, what its plan says, and where the two differ.
 *
 * Both columns, always. An override shown on its own is a number with no context — "12 publications"
 * only means something next to "the plan gives 3".
 */
export async function overrideReport(organizationId: string): Promise<{ planName: string; rows: OverrideRow[]; overrides: Entitlements }> {
  const resolved = await resolveEntitlements(organizationId);
  const subscription = await db.query.organizationSubscriptions.findFirst({
    where: eq(s.organizationSubscriptions.organizationId, organizationId),
    with: { plan: true },
  });
  const overrides = (subscription?.overrides ?? {}) as Entitlements;
  const planEntitlements = { ...FALLBACK_ENTITLEMENTS, ...(subscription?.plan?.entitlements ?? {}) } as Record<string, unknown>;

  const row = (key: string, kind: "limit" | "flag"): OverrideRow => ({
    key,
    label: OVERRIDE_LABELS[key] ?? key,
    kind,
    planValue: (planEntitlements[key] ?? null) as number | boolean | null,
    effective: ((resolved.entitlements as Record<string, unknown>)[key] ?? null) as number | boolean | null,
    overridden: key in overrides,
  });

  return {
    planName: resolved.planName,
    rows: [...LIMIT_KEYS.map((key) => row(key, "limit")), ...FLAG_KEYS.map((key) => row(key, "flag"))],
    overrides,
  };
}

function validate(key: string, value: unknown) {
  if ((LIMIT_KEYS as readonly string[]).includes(key)) {
    if (value === null) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) {
      throw new ValidationError(`${OVERRIDE_LABELS[key]} must be a whole number, or blank for unlimited.`, { [key]: ["Not a usable limit"] });
    }
    return n;
  }
  if ((FLAG_KEYS as readonly string[]).includes(key)) return Boolean(value);
  throw new ValidationError(`${key} is not something that can be overridden.`);
}

/**
 * Set or clear overrides for one workspace.
 *
 * A key mapped to `undefined` is removed, which returns that entitlement to whatever the plan says —
 * distinct from setting it to 0, which is a deliberate "none". The two are easy to conflate and the
 * difference is the whole reason overrides are a patch rather than a copy.
 *
 * Creating the subscription row when there is none: a free workspace has no subscription, and
 * refusing to grant it anything until it pays would make overrides useless in exactly the case they
 * are most often needed — a pilot, a partner, a school you are trying to win.
 */
export async function setOverrides(input: { organizationId: string; patch: Record<string, unknown>; actorId?: string | null; reason?: string }) {
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, input.organizationId), columns: { id: true, name: true } });
  if (!organization) throw new NotFoundError("Workspace");

  const subscription = await db.query.organizationSubscriptions.findFirst({ where: eq(s.organizationSubscriptions.organizationId, input.organizationId) });
  const current = { ...((subscription?.overrides ?? {}) as Record<string, unknown>) };

  const changed: string[] = [];
  for (const [key, value] of Object.entries(input.patch)) {
    if (value === undefined) {
      if (key in current) {
        delete current[key];
        changed.push(`${key}: back to plan`);
      }
      continue;
    }
    const next = validate(key, value);
    if (current[key] !== next) {
      current[key] = next;
      changed.push(`${key}: ${next === null ? "unlimited" : String(next)}`);
    }
  }
  if (!changed.length) return overrideReport(input.organizationId);

  if (subscription) {
    await db
      .update(s.organizationSubscriptions)
      .set({ overrides: current as Entitlements, updatedAt: new Date() })
      .where(eq(s.organizationSubscriptions.id, subscription.id));
  } else {
    const defaultPlan = await db.query.plans.findFirst({ where: eq(s.plans.isDefault, true) });
    if (!defaultPlan) throw new ValidationError("There is no default plan to attach an override to.");
    await db.insert(s.organizationSubscriptions).values({
      organizationId: input.organizationId,
      planId: defaultPlan.id,
      status: "FREE",
      overrides: current as Entitlements,
    });
  }

  await audit({
    action: "platform.overrides",
    entityType: "SETTING",
    entityId: input.organizationId,
    organizationId: input.organizationId,
    userId: input.actorId ?? null,
    metadata: { workspace: organization.name, changed, reason: input.reason ?? null },
  });
  return overrideReport(input.organizationId);
}

/** Drop every override, returning the workspace to exactly what it pays for. */
export async function clearOverrides(organizationId: string, actorId?: string | null) {
  await db
    .update(s.organizationSubscriptions)
    .set({ overrides: {} as Entitlements, updatedAt: new Date() })
    .where(eq(s.organizationSubscriptions.organizationId, organizationId));
  await audit({ action: "platform.overrides.clear", entityType: "SETTING", entityId: organizationId, organizationId, userId: actorId ?? null });
  return overrideReport(organizationId);
}

/* ── People ───────────────────────────────────────────────────────────────────────────────── */

export type PlatformUserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: Date | null;
  workspaces: { organizationId: string; name: string; role: string }[];
};

/** Everyone with an account, and which workspaces they belong to. */
export async function listPlatformUsers(): Promise<PlatformUserRow[]> {
  const [people, memberships] = await Promise.all([
    db
      .select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role, isActive: s.users.isActive, lastLoginAt: s.users.lastLoginAt })
      .from(s.users)
      .orderBy(s.users.name),
    db
      .select({ userId: s.organizationMembers.userId, organizationId: s.organizationMembers.organizationId, role: s.organizationMembers.role, name: s.organizations.name })
      .from(s.organizationMembers)
      .innerJoin(s.organizations, eq(s.organizations.id, s.organizationMembers.organizationId)),
  ]);

  const byUser = new Map<string, PlatformUserRow["workspaces"]>();
  for (const membership of memberships) {
    const list = byUser.get(membership.userId) ?? [];
    list.push({ organizationId: membership.organizationId, name: membership.name, role: membership.role });
    byUser.set(membership.userId, list);
  }
  return people.map((person) => ({ ...person, workspaces: byUser.get(person.id) ?? [] }));
}

/**
 * Change what somebody may do, or stop them doing anything.
 *
 * The platform role is the one that decides whether a person is Briefly staff, so promoting to
 * SUPER_ADMIN hands over the keys to every customer's data. It is allowed — somebody has to be able
 * to — but it is recorded with both names on it, and demoting the last one is refused, because a
 * platform nobody can administer is a platform nobody can fix.
 */
export async function setPlatformRole(input: { userId: string; role: Role; actorId?: string | null }) {
  if (!ROLES.includes(input.role)) throw new ValidationError("Unknown role");
  const user = await db.query.users.findFirst({ where: eq(s.users.id, input.userId), columns: { id: true, name: true, email: true, role: true } });
  if (!user) throw new NotFoundError("User");
  if (user.role === input.role) return user;

  if (user.role === "SUPER_ADMIN" && input.role !== "SUPER_ADMIN") {
    const remaining = await db.query.users.findMany({ where: eq(s.users.role, "SUPER_ADMIN"), columns: { id: true } });
    if (remaining.filter((row) => row.id !== user.id).length === 0) {
      throw new ValidationError("This is the last platform admin. Promote somebody else first.");
    }
  }

  await db.update(s.users).set({ role: input.role }).where(eq(s.users.id, input.userId));
  await audit({
    action: "platform.role",
    entityType: "USER",
    entityId: input.userId,
    userId: input.actorId ?? null,
    metadata: { user: user.email, from: user.role, to: input.role },
  });
  return { ...user, role: input.role };
}

/**
 * Suspend or restore an account.
 *
 * Suspension is a session-level thing, not a data one: the person stops being able to sign in and
 * their existing sessions die, and everything they wrote stays exactly where it is. Deleting people
 * to revoke access is how bylines disappear from published work.
 */
export async function setUserActive(input: { userId: string; isActive: boolean; actorId?: string | null }) {
  const user = await db.query.users.findFirst({ where: eq(s.users.id, input.userId), columns: { id: true, email: true, role: true, isActive: true } });
  if (!user) throw new NotFoundError("User");
  if (user.id === input.actorId && !input.isActive) throw new ValidationError("You cannot suspend your own account.");
  if (user.role === "SUPER_ADMIN" && !input.isActive) {
    const others = await db.query.users.findMany({ where: eq(s.users.role, "SUPER_ADMIN"), columns: { id: true, isActive: true } });
    if (!others.some((row) => row.id !== user.id && row.isActive)) throw new ValidationError("This is the last active platform admin.");
  }

  await db.update(s.users).set({ isActive: input.isActive }).where(eq(s.users.id, input.userId));
  if (!input.isActive) await db.delete(s.sessions).where(eq(s.sessions.userId, input.userId));
  await audit({
    action: input.isActive ? "platform.user.restore" : "platform.user.suspend",
    entityType: "USER",
    entityId: input.userId,
    userId: input.actorId ?? null,
    metadata: { user: user.email },
  });
  return { ...user, isActive: input.isActive };
}
