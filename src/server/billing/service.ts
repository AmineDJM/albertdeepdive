import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { AppError, NotFoundError, ValidationError } from "@/lib/action-result";
import { cancelSubscriptionAtPeriodEnd, createCheckoutSession, createPortalSession, findOrCreateCustomer, getSubscription, mapStatus, stripeConfigured } from "./stripe";

const log = createLogger("billing");

/** The workspace's subscription row, created lazily on the free plan. */
export async function ensureSubscription(organizationId: string) {
  const existing = await db.query.organizationSubscriptions.findFirst({ where: eq(s.organizationSubscriptions.organizationId, organizationId) });
  if (existing) return existing;
  const freePlan = await db.query.plans.findFirst({ where: eq(s.plans.isDefault, true) });
  const [row] = await db.insert(s.organizationSubscriptions).values({ organizationId, planId: freePlan?.id ?? null, status: "FREE" }).returning();
  return row;
}

export async function startCheckout(input: { organizationId: string; planKey: string; interval: "month" | "year"; userEmail: string }) {
  if (!stripeConfigured()) throw new AppError("Payments are not set up on this Briefly yet.", "STRIPE_NOT_CONFIGURED", 503);

  const [organization, plan] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(s.organizations.id, input.organizationId) }),
    db.query.plans.findFirst({ where: eq(s.plans.key, input.planKey) }),
  ]);
  if (!organization) throw new NotFoundError("Workspace");
  if (!plan) throw new NotFoundError("Plan");
  if (plan.isCustomPriced) throw new ValidationError("This plan is priced by arrangement. Get in touch and we'll set it up.");

  const priceId = input.interval === "year" ? plan.stripeYearlyPriceId : plan.stripeMonthlyPriceId;
  if (!priceId) throw new ValidationError(`The ${plan.name} plan has no Stripe price configured for ${input.interval}ly billing.`);

  const subscription = await ensureSubscription(input.organizationId);
  const customerId = await findOrCreateCustomer({
    organizationId: input.organizationId,
    name: organization.name,
    email: input.userEmail,
    existingId: subscription.stripeCustomerId,
  });
  if (customerId !== subscription.stripeCustomerId) {
    await db.update(s.organizationSubscriptions).set({ stripeCustomerId: customerId }).where(eq(s.organizationSubscriptions.id, subscription.id));
  }

  const base = env.NEXT_PUBLIC_APP_URL;
  const session = await createCheckoutSession({
    customerId,
    priceId,
    organizationId: input.organizationId,
    planKey: plan.key,
    successUrl: `${base}/settings/billing?upgraded=${plan.key}`,
    cancelUrl: `${base}/settings/billing`,
    trialDays: plan.trialDays || undefined,
  });
  return session.url;
}

export async function openBillingPortal(organizationId: string) {
  if (!stripeConfigured()) throw new AppError("Payments are not set up on this Briefly yet.", "STRIPE_NOT_CONFIGURED", 503);
  const subscription = await db.query.organizationSubscriptions.findFirst({ where: eq(s.organizationSubscriptions.organizationId, organizationId) });
  if (!subscription?.stripeCustomerId) throw new ValidationError("This workspace has never been billed, so there is nothing to manage yet.");
  const session = await createPortalSession({ customerId: subscription.stripeCustomerId, returnUrl: `${env.NEXT_PUBLIC_APP_URL}/settings/billing` });
  return session.url;
}

export async function setCancelAtPeriodEnd(organizationId: string, cancel: boolean, userId?: string | null) {
  const subscription = await db.query.organizationSubscriptions.findFirst({ where: eq(s.organizationSubscriptions.organizationId, organizationId) });
  if (!subscription?.stripeSubscriptionId) throw new ValidationError("There is no paid subscription to change.");
  await cancelSubscriptionAtPeriodEnd(subscription.stripeSubscriptionId, cancel);
  await db.update(s.organizationSubscriptions).set({ cancelAtPeriodEnd: cancel }).where(eq(s.organizationSubscriptions.id, subscription.id));
  await audit({ action: cancel ? "subscription.cancel" : "subscription.resume", organizationId, userId, entityId: organizationId });
}

/** Write what Stripe says about a subscription into our row. Stripe is the authority on state. */
async function applySubscription(stripeSubscription: Awaited<ReturnType<typeof getSubscription>>) {
  const organizationId = stripeSubscription.metadata?.organizationId;
  if (!organizationId) {
    log.warn("stripe subscription with no organizationId", { id: stripeSubscription.id });
    return null;
  }
  const priceId = stripeSubscription.items?.data?.[0]?.price?.id;
  const plan = priceId
    ? await db.query.plans.findFirst({ where: eq(s.plans.stripeMonthlyPriceId, priceId) }).then(async (p) => p ?? db.query.plans.findFirst({ where: eq(s.plans.stripeYearlyPriceId, priceId) }))
    : null;

  const existing = await ensureSubscription(organizationId);
  const values = {
    planId: plan?.id ?? existing.planId,
    status: mapStatus(stripeSubscription.status),
    interval: stripeSubscription.items?.data?.[0]?.price?.recurring?.interval ?? existing.interval,
    stripeCustomerId: stripeSubscription.customer,
    stripeSubscriptionId: stripeSubscription.id,
    currentPeriodEnd: stripeSubscription.current_period_end ? new Date(stripeSubscription.current_period_end * 1000) : null,
    cancelAtPeriodEnd: !!stripeSubscription.cancel_at_period_end,
    trialEndsAt: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
    canceledAt: stripeSubscription.status === "canceled" ? new Date() : null,
  };
  const [row] = await db.update(s.organizationSubscriptions).set(values).where(eq(s.organizationSubscriptions.id, existing.id)).returning();
  log.info("subscription updated from stripe", { organizationId, status: values.status, plan: plan?.key });
  return row;
}

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

/**
 * Handle one webhook.
 *
 * Recorded by event id before anything is done with it, and refused if that id has been processed
 * before. Stripe retries, and retries arrive out of order; without this, one retry could downgrade
 * a customer who has already upgraded.
 */
export async function handleStripeEvent(event: StripeEvent) {
  const seen = await db.query.billingEvents.findFirst({ where: eq(s.billingEvents.eventId, event.id) });
  if (seen?.processedAt) return { status: "duplicate" as const };

  const [record] = seen
    ? [seen]
    : await db.insert(s.billingEvents).values({ provider: "stripe", eventId: event.id, type: event.type, payload: event.data.object }).returning();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as { subscription?: string };
        if (session.subscription) await applySubscription(await getSubscription(session.subscription));
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(event.data.object as unknown as Awaited<ReturnType<typeof getSubscription>>);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as { subscription?: string };
        if (invoice.subscription) await applySubscription(await getSubscription(invoice.subscription));
        break;
      }
      default:
        // Stripe sends a lot. Recording it and moving on is the correct response to the rest.
        break;
    }
    await db.update(s.billingEvents).set({ processedAt: new Date(), error: null }).where(eq(s.billingEvents.id, record.id));
    return { status: "processed" as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(s.billingEvents).set({ error: message }).where(eq(s.billingEvents.id, record.id));
    log.error("stripe event failed", { type: event.type, id: event.id, err });
    throw err;
  }
}
