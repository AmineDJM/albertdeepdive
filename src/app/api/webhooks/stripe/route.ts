import { NextResponse } from "next/server";
import { handleStripeEvent } from "@/server/billing/service";
import { verifyWebhookSignature } from "@/server/billing/stripe";
import { createLogger } from "@/server/logger";

const log = createLogger("stripe-webhook");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe's webhook endpoint.
 *
 * The signature is checked against the raw body before the payload is parsed, let alone trusted:
 * without that, anyone who finds this URL could grant themselves the Business plan by posting a
 * subscription event. An unverified request gets 400 and nothing else — no hint about why.
 *
 * A handler failure returns 500 on purpose. Stripe retries with backoff, and the event id makes the
 * retry a no-op if it turns out the work had already been done.
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!(await verifyWebhookSignature(payload, signature))) {
    log.warn("rejected webhook with invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!event?.id || !event?.type) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch {
    // Already logged with context; the body is deliberately uninformative.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
