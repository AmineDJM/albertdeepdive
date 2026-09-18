import { NextResponse } from "next/server";
import { integrationValue } from "@/server/integrations/service";
import { parseResendEvent, verifySvixSignature } from "@/server/email/providers/resend";
import { recordDeliveryEvent } from "@/server/email/events";
import { createLogger } from "@/server/logger";

const log = createLogger("resend-webhook");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Resend's webhook endpoint.
 *
 * The signature is checked against the raw body before anything is parsed, let alone believed:
 * without it, anyone who found this URL could mark a customer's subscribers as bounced. A request
 * that does not verify gets 400 and no explanation. A handler failure returns 500 on purpose —
 * Resend retries with backoff, and the event id makes the retry a no-op once the work is done.
 */
export async function POST(request: Request) {
  const secret = await integrationValue("resend", "webhookSecret");
  if (!secret) {
    log.warn("webhook received but no signing secret is configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const payload = await request.text();
  const headers = { id: request.headers.get("svix-id"), timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") };
  if (!verifySvixSignature(payload, headers, secret)) {
    log.warn("rejected webhook with invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const event = parseResendEvent(body, headers.id as string);
  if (!event) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  try {
    const result = await recordDeliveryEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    log.error("webhook handling failed", { type: event.type, err });
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
