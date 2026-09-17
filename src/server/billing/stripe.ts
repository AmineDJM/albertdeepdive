import { createHmac, timingSafeEqual } from "node:crypto";
import { integrationValue } from "@/server/integrations/service";
import { createLogger } from "@/server/logger";
import { AppError } from "@/lib/action-result";

const log = createLogger("stripe");

/**
 * A small Stripe client.
 *
 * Stripe's REST API is stable, form-encoded and well documented; the five calls Briefly makes do
 * not justify pulling in the SDK and its transitive dependencies. Webhook signatures are verified
 * here with node's own crypto, which is what the SDK does anyway.
 *
 * Every function throws if Stripe is not configured, and nothing in the product assumes it is:
 * a Briefly with no Stripe keys is a Briefly where everyone is on the free plan.
 */

const API = "https://api.stripe.com/v1";

/**
 * Credentials come from the integrations console, falling back to the environment. Resolved on every
 * call rather than at boot, so connecting Stripe from the interface takes effect immediately.
 */
export async function stripeConfigured() {
  return Boolean(await integrationValue("stripe", "secretKey"));
}

async function requireKey() {
  const key = await integrationValue("stripe", "secretKey");
  if (!key) throw new AppError("Stripe is not configured", "STRIPE_NOT_CONFIGURED", 503);
  return key;
}

async function webhookSecret() {
  return integrationValue("stripe", "webhookSecret");
}

/** Stripe takes form encoding, including for nested objects: `metadata[orgId]=…`. */
function encode(value: unknown, prefix = ""): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => encode(item, `${prefix}[${i}]`));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => encode(item, prefix ? `${prefix}[${key}]` : key));
  }
  return [`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`];
}

async function call<T>(path: string, options: { method?: "GET" | "POST"; body?: Record<string, unknown>; idempotencyKey?: string } = {}): Promise<T> {
  const key = await requireKey();
  const method = options.method ?? "POST";
  const body = options.body ? encode(options.body).join("&") : undefined;
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      // Pinned: an account-level API upgrade must not silently change what these calls return.
      "stripe-version": "2024-06-20",
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(20_000),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; type?: string } };
  if (!res.ok) {
    const message = json.error?.message ?? `Stripe responded ${res.status}`;
    log.error("stripe call failed", { path, status: res.status, message });
    throw new AppError(message, "STRIPE_ERROR", res.status === 400 ? 400 : 502);
  }
  return json as T;
}

export type StripeCustomer = { id: string; email?: string };
export type StripeCheckoutSession = { id: string; url: string };
export type StripePortalSession = { id: string; url: string };
export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end: boolean;
  current_period_end: number;
  trial_end: number | null;
  items: { data: { price: { id: string; recurring?: { interval?: string } } }[] };
  metadata?: Record<string, string>;
};

export async function findOrCreateCustomer(input: { organizationId: string; name: string; email: string; existingId?: string | null }): Promise<string> {
  if (input.existingId) return input.existingId;
  const customer = await call<StripeCustomer>("/customers", {
    body: { name: input.name, email: input.email, metadata: { organizationId: input.organizationId } },
    // Two clicks on "upgrade" must not produce two customers for one workspace.
    idempotencyKey: `customer:${input.organizationId}`,
  });
  return customer.id;
}

export async function createCheckoutSession(input: {
  customerId: string;
  priceId: string;
  organizationId: string;
  planKey: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
}): Promise<StripeCheckoutSession> {
  return call<StripeCheckoutSession>("/checkout/sessions", {
    body: {
      mode: "subscription",
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: true,
      // On the session *and* on the subscription: the webhook reads it off the subscription, which
      // is the object that later events carry.
      metadata: { organizationId: input.organizationId, planKey: input.planKey },
      subscription_data: {
        metadata: { organizationId: input.organizationId, planKey: input.planKey },
        ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
      },
    },
  });
}

export async function createPortalSession(input: { customerId: string; returnUrl: string }): Promise<StripePortalSession> {
  return call<StripePortalSession>("/billing_portal/sessions", { body: { customer: input.customerId, return_url: input.returnUrl } });
}

export async function getSubscription(subscriptionId: string): Promise<StripeSubscription> {
  return call<StripeSubscription>(`/subscriptions/${subscriptionId}`, { method: "GET" });
}

export async function cancelSubscriptionAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<StripeSubscription> {
  return call<StripeSubscription>(`/subscriptions/${subscriptionId}`, { body: { cancel_at_period_end: cancel } });
}

/**
 * Verify a webhook signature.
 *
 * Without this anyone who finds the endpoint can grant themselves the Business plan by posting a
 * fake `customer.subscription.updated`. The comparison is constant-time, and deliveries older than
 * the tolerance are rejected so a captured request cannot be replayed later.
 */
export async function verifyWebhookSignature(payload: string, header: string | null, toleranceSeconds = 300): Promise<boolean> {
  const secret = await webhookSecret();
  if (!secret || !header) return false;

  const parts = Object.fromEntries(
    header
      .split(",")
      .map((part) => part.split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Map Stripe's subscription states onto ours. Anything unknown is treated as not paying. */
export function mapStatus(stripeStatus: string): "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" | "UNPAID" | "PAUSED" {
  switch (stripeStatus) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
      return "PAST_DUE";
    case "unpaid":
      return "UNPAID";
    case "paused":
      return "PAUSED";
    case "incomplete":
    case "incomplete_expired":
      return "INCOMPLETE";
    default:
      return "CANCELED";
  }
}

/* ── One-click provisioning ───────────────────────────────────────────────────────────────── */

export type StripeWebhookEndpoint = { id: string; url: string; secret?: string; enabled_events: string[]; status: string };
export type StripePrice = { id: string; unit_amount: number | null; currency: string; recurring?: { interval?: string } };
export type StripeProduct = { id: string; name: string };

/**
 * The events Briefly needs, and no others.
 *
 * A webhook subscribed to everything is a webhook whose failures are noise. These four are the only
 * ones that change what a workspace is allowed to do.
 */
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export async function listWebhookEndpoints(): Promise<StripeWebhookEndpoint[]> {
  const res = await call<{ data: StripeWebhookEndpoint[] }>("/webhook_endpoints", { method: "GET", body: { limit: 100 } });
  return res.data ?? [];
}

/**
 * Point Stripe at this Briefly, and hand back the signing secret.
 *
 * Creating the endpoint by hand and copying the `whsec_` across is the single most error-prone step
 * in connecting Stripe, and getting it wrong fails silently — payments work, and then nothing
 * updates. Stripe returns the secret exactly once, at creation, so an endpoint that already exists
 * for this URL is deleted and remade rather than reused: we cannot read the old secret, and an
 * endpoint whose secret nobody holds is worse than no endpoint.
 */
export async function provisionWebhook(url: string): Promise<{ endpoint: StripeWebhookEndpoint; replaced: boolean }> {
  const existing = (await listWebhookEndpoints()).filter((e) => e.url === url);
  for (const endpoint of existing) {
    await call(`/webhook_endpoints/${endpoint.id}`, { method: "POST", body: { disabled: true } }).catch(() => null);
    await fetch(`${API}/webhook_endpoints/${endpoint.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${await requireKey()}`, "stripe-version": "2024-06-20" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
  }
  const endpoint = await call<StripeWebhookEndpoint>("/webhook_endpoints", {
    body: { url, enabled_events: [...WEBHOOK_EVENTS], description: "Briefly — subscription state" },
  });
  return { endpoint, replaced: existing.length > 0 };
}

/**
 * A product and its two prices for one plan.
 *
 * Idempotent on the plan key, so running setup twice does not leave a customer able to buy the same
 * plan at two different prices. A price is immutable in Stripe — changing what you charge means a
 * new price — so an existing one at the right amount is reused and a wrong one is superseded.
 */
export async function provisionPlanPrices(plan: {
  key: string;
  name: string;
  currency: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  stripeProductId?: string | null;
  stripeMonthlyPriceId?: string | null;
  stripeYearlyPriceId?: string | null;
}): Promise<{ productId: string; monthlyPriceId: string | null; yearlyPriceId: string | null }> {
  const product = plan.stripeProductId
    ? await call<StripeProduct>(`/products/${plan.stripeProductId}`, { method: "GET" }).catch(() => null)
    : null;

  const productId =
    product?.id ??
    (
      await call<StripeProduct>("/products", {
        body: { name: `Briefly ${plan.name}`, metadata: { brieflyPlanKey: plan.key } },
        idempotencyKey: `product:${plan.key}`,
      })
    ).id;

  const prices = (await call<{ data: StripePrice[] }>("/prices", { method: "GET", body: { product: productId, active: true, limit: 100 } })).data ?? [];

  const findOrCreate = async (interval: "month" | "year", amount: number): Promise<string | null> => {
    if (amount <= 0) return null;
    const match = prices.find((p) => p.recurring?.interval === interval && p.unit_amount === amount && p.currency === plan.currency.toLowerCase());
    if (match) return match.id;
    const created = await call<StripePrice>("/prices", {
      body: { product: productId, unit_amount: amount, currency: plan.currency.toLowerCase(), recurring: { interval } },
      idempotencyKey: `price:${plan.key}:${interval}:${amount}:${plan.currency}`,
    });
    return created.id;
  };

  return {
    productId,
    monthlyPriceId: await findOrCreate("month", plan.priceMonthlyCents),
    yearlyPriceId: await findOrCreate("year", plan.priceYearlyCents),
  };
}

/** Who the key belongs to, so the console can say which account it just connected. */
export async function accountSummary(): Promise<{ id: string; name: string | null; livemode: boolean }> {
  const account = await call<{ id: string; settings?: { dashboard?: { display_name?: string } }; charges_enabled?: boolean }>("/account", { method: "GET" });
  const key = await requireKey();
  return { id: account.id, name: account.settings?.dashboard?.display_name ?? null, livemode: key.startsWith("sk_live_") };
}
