import { and, eq, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { ReaderPayments } from "@/server/db/schema/identity";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { createLogger } from "@/server/logger";
import { maskSecret, open, seal } from "@/server/settings/secrets";
import { AppError, NotFoundError, ValidationError } from "@/lib/action-result";
import { livemodeOf, looksLikeSecretKey, stripeCall, type StripeAccount, type StripeCheckoutSession, type StripeSubscription } from "./stripe-account";

const log = createLogger("payments");

/**
 * Paid titles.
 *
 * A customer decides whether their readers pay. When they do, the money never passes through
 * Briefly: the customer connects their own Stripe account, the reader checks out on Stripe's page
 * against that account, and the receipt, the refund and the tax question are all theirs. Briefly
 * keeps two things — a sealed copy of the key so it can start a checkout and ask after a
 * subscription, and the answer: who is paying for which title, and until when.
 *
 * Leaving is still one click. A reader who unsubscribes has their Stripe subscription cancelled
 * at the end of what they paid for, so nothing further is charged and nothing has to be refunded.
 */

export type ReaderPaymentsStatus = { provider: "stripe"; keyHint: string; livemode: boolean; accountId: string | null; accountName: string | null; connectedAt: string } | null;

function toPublic(record: ReaderPayments | null | undefined): ReaderPaymentsStatus {
  if (!record) return null;
  return { provider: record.provider, keyHint: record.keyHint, livemode: record.livemode, accountId: record.accountId, accountName: record.accountName, connectedAt: record.connectedAt };
}

export async function readerPaymentsFor(organizationId: string): Promise<ReaderPaymentsStatus> {
  const org = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { readerPayments: true } });
  return toPublic(org?.readerPayments);
}

async function secretKeyFor(organizationId: string): Promise<string> {
  const org = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { readerPayments: true } });
  const key = org?.readerPayments ? open(org.readerPayments.secretKey) : null;
  if (!key) throw new AppError("Reader payments are not connected for this workspace", "PAYMENTS_NOT_CONNECTED", 503);
  return key;
}

/** Connect: the key is tried against the account it belongs to before it is kept, and kept sealed. */
export async function connectReaderPayments(organizationId: string, rawKey: string, actorId?: string | null): Promise<NonNullable<ReaderPaymentsStatus>> {
  const key = rawKey.trim();
  if (!looksLikeSecretKey(key)) {
    throw new ValidationError("That does not look like a Stripe secret key", { secretKey: ["It starts with sk_live_, sk_test_, rk_live_ or rk_test_"] });
  }
  let account: StripeAccount;
  try {
    account = await stripeCall<StripeAccount>(key, "/account", { method: "GET" });
  } catch (error) {
    const reason = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new ValidationError(`Stripe did not accept that key${reason}`, { secretKey: ["Copy it again from Developers → API keys in your Stripe dashboard"] });
  }
  const record: ReaderPayments = {
    provider: "stripe",
    secretKey: seal(key),
    keyHint: maskSecret(key) ?? "••••",
    livemode: livemodeOf(key),
    accountId: account.id,
    accountName: account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? account.email ?? null,
    connectedAt: new Date().toISOString(),
    connectedById: actorId ?? null,
  };
  await db.update(s.organizations).set({ readerPayments: record }).where(eq(s.organizations.id, organizationId));
  await audit({ action: "payments.connect", organizationId, userId: actorId, entityType: "SETTING", metadata: { accountId: account.id, livemode: record.livemode } });
  return toPublic(record)!;
}

/** Disconnect. Refused while a title still charges, so nobody is left paying into an account Briefly can no longer see. */
export async function disconnectReaderPayments(organizationId: string, actorId?: string | null) {
  const paid = await db.query.publications.findFirst({ where: and(eq(s.publications.organizationId, organizationId), eq(s.publications.access, "paid")), columns: { name: true } });
  if (paid) throw new ValidationError(`"${paid.name}" is a paid title. Make your paid titles free first.`);
  await db.update(s.organizations).set({ readerPayments: null }).where(eq(s.organizations.id, organizationId));
  await audit({ action: "payments.disconnect", organizationId, userId: actorId, entityType: "SETTING" });
}

type PricedPublication = { id: string; organizationId: string; name: string; priceCents: number | null; priceCurrency: string; priceInterval: string; paymentRefs: { productId: string; priceId: string; fingerprint: string } | null };

/**
 * The product and price for a paid title in the customer's Stripe, created once and reused.
 *
 * A checkout with an inline price would leave a new product in their dashboard every time somebody
 * subscribed. This leaves one product, named after the title, with one price per change of price.
 */
export async function ensurePriceFor(publication: PricedPublication) {
  if (!publication.priceCents || publication.priceCents <= 0) throw new ValidationError("A paid title needs a price", { priceCents: ["Enter what a subscription costs"] });
  const fingerprint = `${publication.priceCents}:${publication.priceCurrency}:${publication.priceInterval}`;
  if (publication.paymentRefs?.fingerprint === fingerprint) return publication.paymentRefs;
  const key = await secretKeyFor(publication.organizationId);
  const productId = publication.paymentRefs?.productId ?? (await stripeCall<{ id: string }>(key, "/products", { body: { name: publication.name, metadata: { briefly_publication: publication.id } } })).id;
  const price = await stripeCall<{ id: string }>(key, "/prices", {
    body: { product: productId, currency: publication.priceCurrency, unit_amount: publication.priceCents, recurring: { interval: publication.priceInterval }, metadata: { briefly_publication: publication.id } },
  });
  const refs = { productId, priceId: price.id, fingerprint };
  await db.update(s.publications).set({ paymentRefs: refs }).where(eq(s.publications.id, publication.id));
  return refs;
}

/**
 * Start a paid subscription: the reader is recorded as pending, the same as a free subscriber
 * before they confirm, and sent to Stripe's checkout page. The payment is the confirmation.
 *
 * Returns no URL when the address already pays for this title. The caller shows the same
 * "check your inbox" it shows everybody, so the form cannot be used to find out who pays.
 */
export async function startPaidCheckout(publicationId: string, input: { email: string; firstName?: string; locale: "en" | "fr" }, meta?: { ip?: string | null }): Promise<{ url: string | null }> {
  const publication = await db.query.publications.findFirst({ where: eq(s.publications.id, publicationId) });
  if (!publication || publication.access !== "paid" || !publication.subscribeSlug) throw new ValidationError("This title is not a paid title");
  const key = await secretKeyFor(publication.organizationId);
  const refs = await ensurePriceFor(publication);

  const { subscribe } = await import("@/server/subscribers/service");
  const result = await subscribe(publicationId, { email: input.email, firstName: input.firstName, locale: input.locale }, { ip: meta?.ip, source: "subscribe_page_paid" });
  const existing = await db.query.publicationSubscriptions.findFirst({ where: and(eq(s.publicationSubscriptions.publicationId, publicationId), eq(s.publicationSubscriptions.subscriberId, result.subscriberId)) });
  if (existing?.paymentStatus === "active" || existing?.paymentStatus === "past_due") return { url: null };

  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const session = await stripeCall<StripeCheckoutSession>(key, "/checkout/sessions", {
    body: {
      mode: "subscription",
      customer_email: input.email,
      line_items: [{ price: refs.priceId, quantity: 1 }],
      success_url: `${base}/s/${publication.subscribeSlug}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/s/${publication.subscribeSlug}`,
      locale: input.locale,
      allow_promotion_codes: true,
      metadata: { subscriberId: result.subscriberId, publicationId },
      subscription_data: { metadata: { subscriberId: result.subscriberId, publicationId, organizationId: publication.organizationId } },
    },
  });
  if (!session.url) throw new AppError("Stripe did not return a checkout page", "STRIPE_ERROR", 502);
  await db
    .update(s.publicationSubscriptions)
    .set({ checkoutSessionId: session.id })
    .where(and(eq(s.publicationSubscriptions.publicationId, publicationId), eq(s.publicationSubscriptions.subscriberId, result.subscriberId)));
  return { url: session.url };
}

const paymentStatusOf = (subscription: StripeSubscription): "active" | "past_due" | "canceled" =>
  subscription.status === "active" || subscription.status === "trialing" ? "active" : subscription.status === "past_due" ? "past_due" : "canceled";

/**
 * Back from Stripe. The session is read from Stripe with the customer's key — never trusted from
 * the URL — and only a completed one turns the pending reader into a subscribed, paying one.
 * Safe to run twice: a refresh of the welcome page records the same facts again.
 */
export async function completePaidCheckout(slug: string, sessionId: string) {
  const publication = await db.query.publications.findFirst({ where: eq(s.publications.subscribeSlug, slug) });
  if (!publication) throw new NotFoundError("Publication");
  const key = await secretKeyFor(publication.organizationId);
  const session = await stripeCall<StripeCheckoutSession>(key, `/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
  const subscriberId = session.metadata?.subscriberId;
  if (!subscriberId || session.metadata?.publicationId !== publication.id) throw new NotFoundError("Checkout");
  if (session.status !== "complete" || !session.subscription) throw new ValidationError("The payment did not go through. Nothing was charged — you can try again.");
  const subscription = await stripeCall<StripeSubscription>(key, `/subscriptions/${encodeURIComponent(session.subscription)}`, { method: "GET" });

  const [subscriber] = await db
    .update(s.subscribers)
    .set({ status: "SUBSCRIBED", confirmedAt: new Date(), confirmTokenHash: null, confirmTokenExpiresAt: null, unsubscribedAt: null })
    .where(eq(s.subscribers.id, subscriberId))
    .returning();
  if (!subscriber) throw new NotFoundError("Subscriber");
  const payment = {
    isActive: true,
    unsubscribedAt: null,
    paymentStatus: paymentStatusOf(subscription),
    paymentCustomerId: session.customer,
    paymentSubscriptionId: subscription.id,
    checkoutSessionId: session.id,
    paidThrough: new Date(subscription.current_period_end * 1000),
  };
  await db
    .insert(s.publicationSubscriptions)
    .values({ publicationId: publication.id, subscriberId, ...payment })
    .onConflictDoUpdate({ target: [s.publicationSubscriptions.publicationId, s.publicationSubscriptions.subscriberId], set: payment });
  await audit({ action: "subscriber.paid", organizationId: publication.organizationId, actorType: "SYSTEM", entityId: subscriber.id, metadata: { publicationId: publication.id, subscriptionId: subscription.id } });
  return { subscriber, publication };
}

/**
 * Stop the charges for a reader — all their titles, or one — at the end of what they paid for.
 * Best effort: the reader has already been unsubscribed, and a Stripe outage must not undo that;
 * the daily check picks up anything left behind.
 */
export async function cancelPaidSubscriptions(subscriberId: string, publicationId?: string): Promise<number> {
  const rows = await db
    .select({ publicationId: s.publicationSubscriptions.publicationId, subscriptionId: s.publicationSubscriptions.paymentSubscriptionId, organizationId: s.publications.organizationId })
    .from(s.publicationSubscriptions)
    .innerJoin(s.publications, eq(s.publications.id, s.publicationSubscriptions.publicationId))
    .where(
      and(
        eq(s.publicationSubscriptions.subscriberId, subscriberId),
        isNotNull(s.publicationSubscriptions.paymentSubscriptionId),
        or(ne(s.publicationSubscriptions.paymentStatus, "canceled"), sql`${s.publicationSubscriptions.paymentStatus} is null`),
        publicationId ? eq(s.publicationSubscriptions.publicationId, publicationId) : undefined,
      ),
    );
  let cancelled = 0;
  for (const row of rows) {
    try {
      const key = await secretKeyFor(row.organizationId);
      await stripeCall(key, `/subscriptions/${encodeURIComponent(row.subscriptionId!)}`, { body: { cancel_at_period_end: true } });
      await db
        .update(s.publicationSubscriptions)
        .set({ paymentStatus: "canceled" })
        .where(and(eq(s.publicationSubscriptions.subscriberId, subscriberId), eq(s.publicationSubscriptions.publicationId, row.publicationId)));
      cancelled += 1;
    } catch (error) {
      log.warn("could not cancel a paid subscription", { subscriptionId: row.subscriptionId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return cancelled;
}

/** A title that goes free stops charging everybody, at the end of what they paid for. They stay subscribed. */
export async function stopChargingReaders(publicationId: string): Promise<number> {
  const rows = await db
    .select({ subscriberId: s.publicationSubscriptions.subscriberId })
    .from(s.publicationSubscriptions)
    .where(and(eq(s.publicationSubscriptions.publicationId, publicationId), isNotNull(s.publicationSubscriptions.paymentSubscriptionId), ne(s.publicationSubscriptions.paymentStatus, "canceled")));
  let stopped = 0;
  for (const row of rows) stopped += await cancelPaidSubscriptions(row.subscriberId, publicationId);
  return stopped;
}

/**
 * Ask Stripe about every paid reader whose period is ending, and stop the mail for the ones whose
 * subscription did not renew. Runs with the hourly tick; only rows near or past their paid-through
 * date are asked about, so a title with a thousand readers costs a handful of calls a day.
 */
export async function syncPaidReaders(now = new Date()): Promise<{ checked: number; stopped: number; errors: number }> {
  const soon = new Date(now.getTime() + 24 * 3_600_000);
  const rows = await db
    .select({
      publicationId: s.publicationSubscriptions.publicationId,
      subscriberId: s.publicationSubscriptions.subscriberId,
      subscriptionId: s.publicationSubscriptions.paymentSubscriptionId,
      organizationId: s.publications.organizationId,
    })
    .from(s.publicationSubscriptions)
    .innerJoin(s.publications, eq(s.publications.id, s.publicationSubscriptions.publicationId))
    .where(
      and(
        isNotNull(s.publicationSubscriptions.paymentSubscriptionId),
        eq(s.publicationSubscriptions.isActive, true),
        or(sql`${s.publicationSubscriptions.paidThrough} is null`, lt(s.publicationSubscriptions.paidThrough, soon)),
      ),
    );
  const keys = new Map<string, string>();
  const outcome = { checked: 0, stopped: 0, errors: 0 };
  for (const row of rows) {
    try {
      let key = keys.get(row.organizationId);
      if (!key) {
        key = await secretKeyFor(row.organizationId);
        keys.set(row.organizationId, key);
      }
      const subscription = await stripeCall<StripeSubscription>(key, `/subscriptions/${encodeURIComponent(row.subscriptionId!)}`, { method: "GET" });
      outcome.checked += 1;
      const status = paymentStatusOf(subscription);
      if (status === "canceled") {
        await stopReader(row.subscriberId, row.publicationId, row.organizationId);
        outcome.stopped += 1;
      } else {
        await db
          .update(s.publicationSubscriptions)
          .set({ paymentStatus: status, paidThrough: new Date(subscription.current_period_end * 1000) })
          .where(and(eq(s.publicationSubscriptions.subscriberId, row.subscriberId), eq(s.publicationSubscriptions.publicationId, row.publicationId)));
      }
    } catch (error) {
      outcome.errors += 1;
      log.warn("could not check a paid subscription", { subscriptionId: row.subscriptionId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcome;
}

/** A subscription that ended at Stripe ends here: the title stops, and the reader too if it was their last. */
async function stopReader(subscriberId: string, publicationId: string, organizationId: string) {
  await db
    .update(s.publicationSubscriptions)
    .set({ isActive: false, unsubscribedAt: new Date(), paymentStatus: "canceled" })
    .where(and(eq(s.publicationSubscriptions.subscriberId, subscriberId), eq(s.publicationSubscriptions.publicationId, publicationId)));
  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)` })
    .from(s.publicationSubscriptions)
    .where(and(eq(s.publicationSubscriptions.subscriberId, subscriberId), eq(s.publicationSubscriptions.isActive, true)));
  if (Number(remaining) === 0) await db.update(s.subscribers).set({ status: "UNSUBSCRIBED", unsubscribedAt: new Date() }).where(eq(s.subscribers.id, subscriberId));
  await audit({ action: "subscriber.payment_ended", organizationId, actorType: "SYSTEM", entityId: subscriberId, metadata: { publicationId } });
}

/** How many readers pay for each title, for the settings page and the titles list. */
export async function payingReadersByTitle(organizationId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ publicationId: s.publicationSubscriptions.publicationId, paying: sql<number>`count(*)` })
    .from(s.publicationSubscriptions)
    .innerJoin(s.publications, eq(s.publications.id, s.publicationSubscriptions.publicationId))
    .where(and(eq(s.publications.organizationId, organizationId), eq(s.publicationSubscriptions.isActive, true), sql`${s.publicationSubscriptions.paymentStatus} in ('active', 'past_due')`))
    .groupBy(s.publicationSubscriptions.publicationId);
  return new Map(rows.map((row) => [row.publicationId, Number(row.paying)]));
}
