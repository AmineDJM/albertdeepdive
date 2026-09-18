import { cache } from "react";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { Entitlements } from "@/server/db/schema/billing";
import { ForbiddenError } from "@/lib/action-result";
import { optionalOrganizationId } from "@/server/tenancy/context";

/**
 * What a workspace is allowed to do.
 *
 * Resolved as plan entitlements, then per-workspace overrides on top — a negotiated limit or a
 * feature switched on for one customer does not require inventing a new plan. `null` means
 * unlimited and is deliberately distinct from `0`, which means none.
 *
 * Nothing here trusts the client. A limit is checked on the server, at the moment the thing is
 * created, and the UI hiding a button is a courtesy rather than the enforcement.
 */

/** Used when a workspace has no subscription row at all — the shape of the free plan. */
export const FALLBACK_ENTITLEMENTS: Entitlements = {
  publications: 1,
  users: 2,
  subscribers: 250,
  editionsPerMonth: 2,
  outputs: ["EMAIL", "WEB"],
  customDomain: false,
  removeBrieflyBranding: false,
  approvalWorkflows: false,
  advancedAnalytics: false,
  apiAccess: false,
  webhooks: false,
  printFeatures: false,
  creativeCredits: 0,
  audioNarration: false,
  premiumVoices: false,
  audioEditions: false,
  multilingualNarration: false,
  brandVoice: false,
  voiceCloning: false,
  multipleTakes: false,
  narrationMinutes: 0,
};

export type ResolvedPlan = {
  organizationId: string;
  planKey: string;
  planName: string;
  status: (typeof s.subscriptionStatusEnum.enumValues)[number];
  interval: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  entitlements: Entitlements;
};

/**
 * A lapsed subscription falls back to the free plan rather than locking the customer out.
 *
 * Losing access to your own archive because a card expired is the kind of thing that ends a
 * relationship. PAST_DUE keeps working while Stripe retries; only once it is properly CANCELED or
 * UNPAID does the workspace drop to free limits — and it keeps its data either way.
 */
function isPaying(status: (typeof s.subscriptionStatusEnum.enumValues)[number]) {
  return status === "ACTIVE" || status === "TRIALING" || status === "PAST_DUE";
}

export async function resolveEntitlements(organizationId: string): Promise<ResolvedPlan> {
  const subscription = await db.query.organizationSubscriptions.findFirst({
    where: eq(s.organizationSubscriptions.organizationId, organizationId),
    with: { plan: true },
  });

  const freePlan = await db.query.plans.findFirst({ where: eq(s.plans.isDefault, true) });
  const effectivePlan = subscription && isPaying(subscription.status) ? (subscription.plan ?? freePlan) : freePlan;

  return {
    organizationId,
    planKey: effectivePlan?.key ?? "free",
    planName: effectivePlan?.name ?? "Free",
    status: subscription?.status ?? "FREE",
    interval: subscription?.interval ?? "month",
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    trialEndsAt: subscription?.trialEndsAt ?? null,
    entitlements: { ...FALLBACK_ENTITLEMENTS, ...(effectivePlan?.entitlements ?? {}), ...(subscription?.overrides ?? {}) },
  };
}

/** The active workspace's plan, memoised per request. */
export const currentPlan = cache(async (): Promise<ResolvedPlan | null> => {
  const organizationId = await optionalOrganizationId();
  if (!organizationId) return null;
  return resolveEntitlements(organizationId);
});

export type LimitKey = "publications" | "users" | "subscribers" | "editionsPerMonth";

/** What a workspace is currently using, for the limit checks and the usage display. */
export async function currentUsage(organizationId: string): Promise<Record<LimitKey, number>> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [[publications], [users], [subscribers], [editions]] = await Promise.all([
    db.select({ n: count() }).from(s.publications).where(eq(s.publications.organizationId, organizationId)),
    db.select({ n: count() }).from(s.organizationMembers).where(eq(s.organizationMembers.organizationId, organizationId)),
    db
      .select({ n: count() })
      .from(s.subscribers)
      .where(and(eq(s.subscribers.organizationId, organizationId), eq(s.subscribers.status, "SUBSCRIBED"))),
    db
      .select({ n: count() })
      .from(s.editions)
      .where(and(eq(s.editions.organizationId, organizationId), gte(s.editions.createdAt, monthStart))),
  ]);

  return {
    publications: Number(publications.n),
    users: Number(users.n),
    subscribers: Number(subscribers.n),
    editionsPerMonth: Number(editions.n),
  };
}

const LIMIT_MESSAGES: Record<LimitKey, (limit: number) => string> = {
  publications: (n) => `Your plan includes ${n} publication${n === 1 ? "" : "s"}.`,
  users: (n) => `Your plan includes ${n} team member${n === 1 ? "" : "s"}.`,
  subscribers: (n) => `Your plan includes ${n.toLocaleString()} subscribers.`,
  editionsPerMonth: (n) => `Your plan includes ${n} edition${n === 1 ? "" : "s"} a month.`,
};

export type LimitCheck = { allowed: boolean; used: number; limit: number | null; message?: string };

/** Is there room for one more? `null` limits are unlimited and always allow. */
export async function checkLimit(organizationId: string, key: LimitKey, adding = 1): Promise<LimitCheck> {
  const [plan, usage] = await Promise.all([resolveEntitlements(organizationId), currentUsage(organizationId)]);
  const limit = plan.entitlements[key];
  if (limit === null || limit === undefined) return { allowed: true, used: usage[key], limit: null };
  const numeric = Number(limit);
  const allowed = usage[key] + adding <= numeric;
  return {
    allowed,
    used: usage[key],
    limit: numeric,
    message: allowed ? undefined : `${LIMIT_MESSAGES[key](numeric)} Upgrade to add more.`,
  };
}

export async function requireLimit(organizationId: string, key: LimitKey, adding = 1) {
  const result = await checkLimit(organizationId, key, adding);
  if (!result.allowed) throw new ForbiddenError(result.message ?? "Plan limit reached");
  return result;
}

export type FeatureKey =
  | "customDomain"
  | "removeBrieflyBranding"
  | "approvalWorkflows"
  | "advancedAnalytics"
  | "apiAccess"
  | "webhooks"
  | "printFeatures"
  | "socialCarousels"
  | "socialPack"
  | "videoGeneration"
  | "cinematicMode"
  | "customBrandSystem"
  | "advancedTemplates"
  | "audioNarration"
  | "premiumVoices"
  | "audioEditions"
  | "multilingualNarration"
  | "brandVoice"
  | "voiceCloning"
  | "multipleTakes";

export async function hasFeature(organizationId: string, feature: FeatureKey): Promise<boolean> {
  const plan = await resolveEntitlements(organizationId);
  return plan.entitlements[feature] === true;
}

export async function requireFeature(organizationId: string, feature: FeatureKey, label?: string) {
  if (!(await hasFeature(organizationId, feature))) {
    throw new ForbiddenError(`${label ?? "That feature"} is not included in your plan.`);
  }
}

/** Whether a plan may publish in a given format. An empty list means every format is allowed. */
export async function canPublishFormat(organizationId: string, format: string): Promise<boolean> {
  const plan = await resolveEntitlements(organizationId);
  const outputs = plan.entitlements.outputs;
  if (!outputs || !outputs.length) return true;
  return outputs.includes(format);
}

/** Free-plan pages and emails carry Briefly's mark; paid ones do not. */
export async function showsBrieflyBranding(organizationId: string): Promise<boolean> {
  const plan = await resolveEntitlements(organizationId);
  return plan.entitlements.removeBrieflyBranding !== true;
}

/** Usage against limits, for the billing screen. */
export async function usageReport(organizationId: string) {
  const [plan, usage] = await Promise.all([resolveEntitlements(organizationId), currentUsage(organizationId)]);
  const keys: LimitKey[] = ["publications", "users", "subscribers", "editionsPerMonth"];
  return {
    plan,
    lines: keys.map((key) => {
      const raw = plan.entitlements[key];
      const limit = raw === null || raw === undefined ? null : Number(raw);
      return {
        key,
        used: usage[key],
        limit,
        ratio: limit && limit > 0 ? Math.min(1, usage[key] / limit) : 0,
      };
    }),
  };
}

/** Counts across every workspace, for the super-admin console. */
export async function platformBillingSummary() {
  const rows = await db
    .select({
      planKey: s.plans.key,
      planName: s.plans.name,
      priceMonthlyCents: s.plans.priceMonthlyCents,
      isCustomPriced: s.plans.isCustomPriced,
      workspaces: sql<number>`count(${s.organizationSubscriptions.id})`,
      paying: sql<number>`count(${s.organizationSubscriptions.id}) filter (where ${s.organizationSubscriptions.status} in ('ACTIVE','TRIALING','PAST_DUE'))`,
    })
    .from(s.plans)
    .leftJoin(s.organizationSubscriptions, eq(s.organizationSubscriptions.planId, s.plans.id))
    .groupBy(s.plans.id, s.plans.key, s.plans.name, s.plans.priceMonthlyCents, s.plans.isCustomPriced, s.plans.sortOrder)
    .orderBy(s.plans.sortOrder);

  const mrrCents = rows.reduce((total, r) => total + Number(r.paying) * r.priceMonthlyCents, 0);
  return { rows: rows.map((r) => ({ ...r, workspaces: Number(r.workspaces), paying: Number(r.paying) })), mrrCents };
}
