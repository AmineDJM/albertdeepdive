import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { subscriptionStatusEnum } from "./enums";
import { organizations } from "./identity";

/**
 * Billing.
 *
 * Plans live in the database rather than in code so that pricing can change without a deploy: the
 * super admin edits a plan, and the marketing page, the upgrade screen and every limit check read
 * the same row. There is exactly one source of truth for what a customer is allowed to do.
 *
 * Money is stored in cents as integers. Floating point and currency do not belong in the same
 * sentence.
 */

/**
 * What a plan allows. `null` means unlimited — deliberately distinct from `0`, which means none.
 *
 * Unknown keys are kept: a plan configured for a feature this build does not know about yet stays
 * intact through an upgrade rather than being silently dropped.
 */
export type Entitlements = {
  publications?: number | null;
  users?: number | null;
  subscribers?: number | null;
  editionsPerMonth?: number | null;
  /**
   * Re-edits of an issue that has already been made, counted per issue.
   *
   * Each one re-runs the layout, re-renders every format and, where a film is part of the issue,
   * re-cuts it — which is where the money goes. Counted per issue rather than per month because
   * that is what the cost follows and what a person can hold in their head: this issue has had two
   * of its three.
   */
  revisionsPerEdition?: number | null;
  /** Output formats this plan may publish in. */
  outputs?: string[];
  customDomain?: boolean;
  removeBrieflyBranding?: boolean;
  approvalWorkflows?: boolean;
  advancedAnalytics?: boolean;
  apiAccess?: boolean;
  webhooks?: boolean;
  printFeatures?: boolean;
  prioritySupport?: boolean;
  /** Creative Studio, metered separately from the publishing limits above. */
  creativeCredits?: number | null;
  socialCarousels?: boolean;
  socialPack?: boolean;
  videoGeneration?: boolean;
  cinematicMode?: boolean;
  maxVideoMinutes?: number | null;
  maxAiImages?: number | null;
  maxAiVideoSeconds?: number | null;
  customBrandSystem?: boolean;
  advancedTemplates?: boolean;
  /** Spoken Briefly: narrations, metered in minutes a month. */
  audioNarration?: boolean;
  premiumVoices?: boolean;
  audioEditions?: boolean;
  multilingualNarration?: boolean;
  brandVoice?: boolean;
  voiceCloning?: boolean;
  multipleTakes?: boolean;
  narrationMinutes?: number | null;
  [key: string]: unknown;
};

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable identifier used in code and in Stripe metadata; the display name may change freely. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    description: text("description"),
    priceMonthlyCents: integer("price_monthly_cents").notNull().default(0),
    priceYearlyCents: integer("price_yearly_cents").notNull().default(0),
    currency: text("currency").notNull().default("EUR"),
    stripeProductId: text("stripe_product_id"),
    stripeMonthlyPriceId: text("stripe_monthly_price_id"),
    stripeYearlyPriceId: text("stripe_yearly_price_id"),
    entitlements: jsonb("entitlements").$type<Entitlements>().notNull().default({}),
    /** Bullet points for the pricing table, in the order they should be read. */
    highlights: text("highlights").array().notNull().default([]),
    /** Shown on the public pricing page. A private plan can still be assigned by a super admin. */
    isPublic: boolean("is_public").notNull().default(true),
    /** The plan a new workspace lands on. Exactly one plan should carry it. */
    isDefault: boolean("is_default").notNull().default(false),
    /** "Most popular" on the pricing table. */
    isFeatured: boolean("is_featured").notNull().default(false),
    /** Priced by conversation rather than by card. */
    isCustomPriced: boolean("is_custom_priced").notNull().default(false),
    trialDays: integer("trial_days").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("plans_key_idx").on(t.key), index("plans_sort_idx").on(t.sortOrder)],
);

export const organizationSubscriptions = pgTable(
  "organization_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "set null" }),
    status: subscriptionStatusEnum("status").notNull().default("ACTIVE"),
    interval: text("interval").notNull().default("month"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    /** Per-workspace overrides on top of the plan — a negotiated limit, or a feature switched on. */
    overrides: jsonb("overrides").$type<Entitlements>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("organization_subscriptions_org_idx").on(t.organizationId),
    uniqueIndex("organization_subscriptions_stripe_idx").on(t.stripeSubscriptionId),
    index("organization_subscriptions_status_idx").on(t.status),
  ],
);

/**
 * Every webhook Stripe has delivered, by its event id.
 *
 * Stripe retries, and retries arrive out of order. Recording the id and refusing to process it
 * twice is what keeps one retry from charging a customer's usage twice or downgrading them after
 * they have already upgraded.
 */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("stripe"),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("billing_events_provider_event_idx").on(t.provider, t.eventId), index("billing_events_org_idx").on(t.organizationId)],
);
