import { createLogger } from "@/server/logger";
import { AppError } from "@/lib/action-result";

const API = "https://api.stripe.com/v1";
const log = createLogger("stripe:account");

/**
 * Stripe, on somebody else's account.
 *
 * Briefly's own billing talks to Briefly's Stripe. A paid title talks to the customer's: their key,
 * their customers, their money, their receipts, their dashboard. The two share nothing but the wire
 * format, so this client takes the key as an argument and holds no state of its own — and the
 * transport is swappable, so the whole flow from checkout to cancellation can be exercised without
 * a network and without a real account.
 */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

const live: Transport = (url, init) => fetch(url, init);
let transport: Transport = live;

/** Tests only: answer Stripe's calls locally. Pass null to go back to the network. */
export function setStripeTransportForTests(next: Transport | null) {
  transport = next ?? live;
}

/** Stripe takes form encoding, nested objects included: `line_items[0][price]=…`. */
function encode(value: unknown, prefix = ""): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => encode(item, `${prefix}[${index}]`));
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => encode(item, prefix ? `${prefix}[${key}]` : key));
  }
  return `${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}` ? [`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`] : [];
}

export async function stripeCall<T>(key: string, path: string, options: { method?: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> } = {}): Promise<T> {
  const method = options.method ?? "POST";
  const body = options.body ? encode(options.body).join("&") : undefined;
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`;
  const response = await transport(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      // Pinned: an account-level API upgrade on the customer's side must not change what these calls return.
      "stripe-version": "2024-06-20",
    },
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string; type?: string } };
  if (!response.ok) {
    const message = json.error?.message ?? `Stripe responded ${response.status}`;
    log.warn("stripe call failed", { path, status: response.status, message });
    throw new AppError(message, "STRIPE_ERROR", response.status === 401 ? 401 : response.status === 400 ? 400 : 502);
  }
  return json as T;
}

export type StripeAccount = {
  id: string;
  email?: string | null;
  charges_enabled?: boolean;
  business_profile?: { name?: string | null } | null;
  settings?: { dashboard?: { display_name?: string | null } | null } | null;
};
export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired";
  customer: string | null;
  subscription: string | null;
  metadata?: Record<string, string>;
};
export type StripeSubscription = {
  id: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "incomplete_expired" | "paused";
  current_period_end: number;
  cancel_at_period_end: boolean;
};

/** A live key charges real cards; a test key charges nobody. The page says which is connected. */
export const livemodeOf = (key: string) => /^(sk|rk)_live_/.test(key);
export const looksLikeSecretKey = (key: string) => /^(sk|rk)_(live|test)_[A-Za-z0-9]{8,}$/.test(key);
