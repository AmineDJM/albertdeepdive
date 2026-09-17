import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { Entitlements } from "@/server/db/schema/billing";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";

/**
 * The plans Briefly ships with.
 *
 * These are seeded once and then owned by the super admin: editing a price or a limit in the
 * console changes what customers see and what they are allowed to do, without a deploy. They are
 * defined here only so a fresh install has something coherent to sell.
 */
export const DEFAULT_PLANS: {
  key: string;
  name: string;
  tagline: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  entitlements: Entitlements;
  highlights: string[];
  isDefault?: boolean;
  isFeatured?: boolean;
  isCustomPriced?: boolean;
  sortOrder: number;
}[] = [
  {
    key: "free",
    name: "Free",
    tagline: "For trying Briefly.",
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    sortOrder: 0,
    isDefault: true,
    entitlements: {
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
      socialCarousels: false,
      socialPack: false,
      videoGeneration: false,
      cinematicMode: false,
    },
    highlights: ["1 publication", "2 users", "250 subscribers", "Email and web editions", "Briefly branding"],
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "For small teams publishing regularly.",
    priceMonthlyCents: 5900,
    priceYearlyCents: 56_400, // two months free
    sortOrder: 1,
    entitlements: {
      publications: 3,
      users: 5,
      subscribers: 5000,
      editionsPerMonth: null,
      outputs: ["EMAIL", "WEB", "MAGAZINE"],
      customDomain: true,
      removeBrieflyBranding: true,
      approvalWorkflows: false,
      advancedAnalytics: false,
      apiAccess: false,
      webhooks: false,
      printFeatures: false,
      creativeCredits: 200,
      socialCarousels: true,
      socialPack: true,
      videoGeneration: false,
      cinematicMode: false,
    },
    highlights: ["3 publications", "5 users", "5,000 subscribers", "Magazine and PDF", "Social carousels", "Custom domain", "No Briefly branding"],
  },
  {
    key: "business",
    name: "Business",
    tagline: "For organizations running their communication through Briefly.",
    priceMonthlyCents: 19_900,
    priceYearlyCents: 190_800,
    sortOrder: 2,
    isFeatured: true,
    entitlements: {
      publications: 10,
      users: 20,
      subscribers: 25_000,
      editionsPerMonth: null,
      outputs: ["EMAIL", "WEB", "MAGAZINE", "PRINT"],
      customDomain: true,
      removeBrieflyBranding: true,
      approvalWorkflows: true,
      advancedAnalytics: true,
      apiAccess: true,
      webhooks: true,
      printFeatures: true,
      creativeCredits: 1000,
      socialCarousels: true,
      socialPack: true,
      videoGeneration: true,
      cinematicMode: false,
      customBrandSystem: true,
      advancedTemplates: true,
    },
    highlights: [
      "10 publications",
      "20 users",
      "25,000 subscribers",
      "Everything in Pro",
      "Video generation",
      "Approval workflows",
      "Advanced analytics",
      "API and webhooks",
      "Print",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    tagline: "For larger organizations.",
    priceMonthlyCents: 0,
    priceYearlyCents: 0,
    sortOrder: 3,
    isCustomPriced: true,
    entitlements: {
      publications: null,
      users: null,
      subscribers: null,
      editionsPerMonth: null,
      outputs: ["EMAIL", "WEB", "MAGAZINE", "PRINT"],
      customDomain: true,
      removeBrieflyBranding: true,
      approvalWorkflows: true,
      advancedAnalytics: true,
      apiAccess: true,
      webhooks: true,
      printFeatures: true,
      prioritySupport: true,
      creativeCredits: null,
      socialCarousels: true,
      socialPack: true,
      videoGeneration: true,
      cinematicMode: true,
      customBrandSystem: true,
      advancedTemplates: true,
    },
    highlights: ["Unlimited publications and users", "Custom subscriber limits", "Multiple workspaces", "SSO", "Priority support", "Custom onboarding", "SLA"],
  },
];

/** Idempotent: run on every deploy, only creates what is missing. Never overwrites edited prices. */
export async function ensureDefaultPlans() {
  const existing = await db.select({ key: s.plans.key }).from(s.plans);
  const known = new Set(existing.map((p) => p.key));
  const missing = DEFAULT_PLANS.filter((p) => !known.has(p.key));
  if (!missing.length) return [];
  return db
    .insert(s.plans)
    .values(
      missing.map((p) => ({
        key: p.key,
        name: p.name,
        tagline: p.tagline,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        entitlements: p.entitlements,
        highlights: p.highlights,
        isDefault: p.isDefault ?? false,
        isFeatured: p.isFeatured ?? false,
        isCustomPriced: p.isCustomPriced ?? false,
        sortOrder: p.sortOrder,
      })),
    )
    .returning();
}

export async function listPlans(includePrivate = false) {
  const rows = await db.select().from(s.plans).orderBy(asc(s.plans.sortOrder));
  return includePrivate ? rows : rows.filter((p) => p.isPublic);
}

export async function getPlanByKey(key: string) {
  return db.query.plans.findFirst({ where: eq(s.plans.key, key) });
}

export const planPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  tagline: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  priceMonthlyCents: z.number().int().min(0).max(10_000_000).optional(),
  priceYearlyCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
  stripeProductId: z.string().trim().max(120).nullable().optional(),
  stripeMonthlyPriceId: z.string().trim().max(120).nullable().optional(),
  stripeYearlyPriceId: z.string().trim().max(120).nullable().optional(),
  entitlements: z.record(z.string(), z.unknown()).optional(),
  highlights: z.array(z.string().trim().max(120)).max(20).optional(),
  isPublic: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isCustomPriced: z.boolean().optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  sortOrder: z.number().int().optional(),
});

export async function updatePlan(planId: string, raw: z.input<typeof planPatchSchema>, userId?: string | null) {
  const patch = planPatchSchema.parse(raw);
  const plan = await db.query.plans.findFirst({ where: eq(s.plans.id, planId) });
  if (!plan) throw new NotFoundError("Plan");
  // The default plan is where a lapsed subscription lands, so it must stay free and visible.
  if (plan.isDefault && patch.priceMonthlyCents && patch.priceMonthlyCents > 0) {
    throw new ValidationError("The default plan is the one a lapsed subscription falls back to, so it cannot be priced.");
  }
  const [row] = await db
    .update(s.plans)
    .set(patch as Partial<typeof s.plans.$inferInsert>)
    .where(eq(s.plans.id, planId))
    .returning();
  await audit({ action: "plan.update", userId, metadata: { key: plan.key, fields: Object.keys(patch) } });
  return row;
}

/** Exactly one plan is the landing place for new and lapsed workspaces. */
export async function setDefaultPlan(planId: string, userId?: string | null) {
  const plan = await db.query.plans.findFirst({ where: eq(s.plans.id, planId) });
  if (!plan) throw new NotFoundError("Plan");
  if (plan.priceMonthlyCents > 0) throw new ValidationError("The default plan must be free.");
  await db.transaction(async (tx) => {
    await tx.update(s.plans).set({ isDefault: false }).where(eq(s.plans.isDefault, true));
    await tx.update(s.plans).set({ isDefault: true }).where(eq(s.plans.id, planId));
  });
  await audit({ action: "plan.set_default", userId, metadata: { key: plan.key } });
}

/** Put a workspace on a plan directly, without Stripe — for enterprise deals and for support. */
export async function assignPlan(organizationId: string, planId: string | null, options: { status?: (typeof s.subscriptionStatusEnum.enumValues)[number]; overrides?: Entitlements } = {}, userId?: string | null) {
  const existing = await db.query.organizationSubscriptions.findFirst({ where: eq(s.organizationSubscriptions.organizationId, organizationId) });
  const values = { planId, status: options.status ?? (planId ? ("ACTIVE" as const) : ("FREE" as const)), overrides: options.overrides ?? existing?.overrides ?? {} };
  const row = existing
    ? (await db.update(s.organizationSubscriptions).set(values).where(eq(s.organizationSubscriptions.id, existing.id)).returning())[0]
    : (await db.insert(s.organizationSubscriptions).values({ organizationId, ...values }).returning())[0];
  await audit({ action: "subscription.assign", organizationId, userId, entityId: organizationId, metadata: { planId, status: values.status } });
  return row;
}

/**
 * Give every workspace without one a subscription row.
 *
 * Run after `ensureDefaultPlans`. A workspace with no row is treated as free anyway, but the row is
 * what the billing screen, the usage counters and Stripe attach to.
 *
 * A workspace that already has editions predates billing. Dropping it to free limits would take
 * away the magazine it was already producing and the team already using it, which is not a thing to
 * do to a working install — so it is grandfathered onto the most capable priced plan. New
 * workspaces, which have nothing yet, start on free like everyone else.
 */
export async function backfillSubscriptions() {
  const [freePlan, allPlans] = await Promise.all([
    db.query.plans.findFirst({ where: eq(s.plans.isDefault, true) }),
    db.select().from(s.plans).orderBy(asc(s.plans.sortOrder)),
  ]);
  if (!freePlan) return 0;
  const grandfatherPlan = [...allPlans].reverse().find((p) => !p.isCustomPriced && !p.isDefault) ?? freePlan;

  const organizations = await db.select({ id: s.organizations.id }).from(s.organizations);
  const existing = await db.select({ organizationId: s.organizationSubscriptions.organizationId }).from(s.organizationSubscriptions);
  const known = new Set(existing.map((r) => r.organizationId));
  const missing = organizations.filter((o) => !known.has(o.id));
  if (!missing.length) return 0;

  const withEditions = new Set((await db.selectDistinct({ organizationId: s.editions.organizationId }).from(s.editions)).map((r) => r.organizationId).filter((id): id is string => !!id));

  await db.insert(s.organizationSubscriptions).values(
    missing.map((o) =>
      withEditions.has(o.id)
        ? { organizationId: o.id, planId: grandfatherPlan.id, status: "ACTIVE" as const }
        : { organizationId: o.id, planId: freePlan.id, status: "FREE" as const },
    ),
  );
  return missing.length;
}
