import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
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

export function stripeConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY);
}

function requireKey() {
  if (!env.STRIPE_SECRET_KEY) throw new AppError("Stripe is not configured", "STRIPE_NOT_CONFIGURED", 503);
  return env.STRIPE_SECRET_KEY;
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
  const key = requireKey();
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
export function verifyWebhookSignature(payload: string, header: string | null, toleranceSeconds = 300): boolean {
  const secret = env.STRIPE_WEBHOOK_SECRET;
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
