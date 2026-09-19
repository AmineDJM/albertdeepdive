import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { markBounced } from "@/server/subscribers/service";
import { createLogger } from "@/server/logger";
import type { DeliveryEvent } from "./providers/types";

const log = createLogger("email-events");

/**
 * What the provider says happened, written where Briefly keeps the truth.
 *
 * The log row that sent the message is found by the provider's message id — never by anything in
 * the payload that names a workspace, because a payload is only as trustworthy as its signature and
 * the signature says "Resend sent this", not "this belongs to Acme". A permanent bounce or a
 * complaint also retires the subscriber, in that workspace only, so the next edition does not try
 * the same address and burn the domain's reputation doing it.
 */

type Delivery = (typeof s.emailDeliveryEnum.enumValues)[number];

/** Once an address has bounced or complained, a late "delivered" must not talk over it. */
const FINAL: Delivery[] = ["BOUNCED", "COMPLAINED", "SUPPRESSED"];

/**
 * Where a message's delivery state moves when the provider reports this, and nowhere else.
 *
 * Kept apart from the patch so the state machine has exactly one implementation. The webhook
 * applies it as events arrive; reconciliation replays the same function over the events already
 * stored and compares where it lands with where the row sits. A second opinion about what a soft
 * bounce means would report drift on every row rather than on the rows that drifted, which is the
 * one way to make a reconciliation worse than no reconciliation at all.
 *
 * Null means the event does not move the state: an open never does, and a "delivered" that arrives
 * after a bounce must not talk over it.
 */
export function deliveryFrom(event: DeliveryEvent, current: Delivery): Delivery | null {
  switch (event.kind) {
    case "delivered":
      return FINAL.includes(current) ? null : "DELIVERED";
    case "delayed":
      return current === "PENDING" ? "DELAYED" : null;
    case "bounced":
      return event.permanent ? "BOUNCED" : current === "PENDING" ? "DELAYED" : null;
    case "complained":
      return "COMPLAINED";
    case "suppressed":
      return "SUPPRESSED";
    case "failed":
      return "FAILED";
    default:
      return null;
  }
}

function patchFor(event: DeliveryEvent, current: Delivery): Partial<typeof s.emailLog.$inferInsert> {
  const at = event.occurredAt;
  const next = deliveryFrom(event, current);
  switch (event.kind) {
    case "delivered":
      return next ? { delivery: next, deliveredAt: at, deliveryDetail: null } : { deliveredAt: at };
    case "delayed":
      return next ? { delivery: next, deliveryDetail: event.detail } : {};
    case "bounced":
      return next === "BOUNCED" ? { delivery: "BOUNCED", bouncedAt: at, deliveryDetail: event.detail } : { delivery: next ?? current, deliveryDetail: event.detail };
    case "complained":
      return { delivery: "COMPLAINED", bouncedAt: at, deliveryDetail: event.detail ?? "Marked as spam by the recipient" };
    case "suppressed":
      return { delivery: "SUPPRESSED", bouncedAt: at, deliveryDetail: event.detail ?? "On the provider's suppression list" };
    case "failed":
      return { delivery: "FAILED", deliveryDetail: event.detail };
    case "opened":
      return { openedAt: sql`coalesce(${s.emailLog.openedAt}, ${at.toISOString()}::timestamptz)` as unknown as Date, opens: sql`${s.emailLog.opens} + 1` as unknown as number };
    case "clicked":
      return { clickedAt: sql`coalesce(${s.emailLog.clickedAt}, ${at.toISOString()}::timestamptz)` as unknown as Date, clicks: sql`${s.emailLog.clicks} + 1` as unknown as number };
    default:
      return {};
  }
}

export type RecordedEvent = { status: "recorded" | "duplicate" | "ignored"; emailLogId?: string; organizationId?: string | null };

export async function recordDeliveryEvent(event: DeliveryEvent): Promise<RecordedEvent> {
  const inserted = await db
    .insert(s.emailEvents)
    .values({ providerEventId: event.id, provider: "resend", type: event.type, recipient: event.recipients[0] ?? null, detail: event.detail, payload: event.raw ?? {}, occurredAt: event.occurredAt })
    .onConflictDoNothing()
    .returning({ id: s.emailEvents.id });
  if (!inserted.length) return { status: "duplicate" };
  const eventRowId = inserted[0].id;

  if (event.kind === "domain") {
    if (!event.providerDomainId) return { status: "ignored" };
    const domain = await db.query.sendingDomains.findFirst({ where: eq(s.sendingDomains.providerDomainId, event.providerDomainId) });
    if (!domain) return { status: "ignored" };
    await db.update(s.emailEvents).set({ organizationId: domain.organizationId }).where(eq(s.emailEvents.id, eventRowId));
    if (event.type !== "domain.deleted") {
      const { checkSendingDomain } = await import("./domains");
      await checkSendingDomain(domain, { force: true }).catch((err) => log.warn("domain check after webhook failed", { organizationId: domain.organizationId, err }));
    }
    return { status: "recorded", organizationId: domain.organizationId };
  }

  if (!event.providerMessageId) return { status: "ignored" };
  const row = await db.query.emailLog.findFirst({ where: eq(s.emailLog.providerMessageId, event.providerMessageId) });
  if (!row) return { status: "ignored" };
  await db.update(s.emailEvents).set({ organizationId: row.organizationId, emailLogId: row.id }).where(eq(s.emailEvents.id, eventRowId));

  const patch = patchFor(event, row.delivery);
  if (Object.keys(patch).length) await db.update(s.emailLog).set(patch).where(eq(s.emailLog.id, row.id));

  const retire = (event.kind === "bounced" && event.permanent) || event.kind === "complained" || event.kind === "suppressed";
  if (retire && row.organizationId) {
    const addresses = event.recipients.length ? event.recipients : [row.to];
    for (const address of addresses) await markBounced(row.organizationId, address, event.kind === "complained");
  }
  return { status: "recorded", emailLogId: row.id, organizationId: row.organizationId };
}

/** Delivery, in numbers, for one workspace over the last `days`. */
export async function deliveryStats(organizationId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      sent: sql<number>`count(*) filter (where ${s.emailLog.status} = 'SENT')`,
      delivered: sql<number>`count(*) filter (where ${s.emailLog.delivery} = 'DELIVERED')`,
      bounced: sql<number>`count(*) filter (where ${s.emailLog.delivery} in ('BOUNCED', 'SUPPRESSED'))`,
      complained: sql<number>`count(*) filter (where ${s.emailLog.delivery} = 'COMPLAINED')`,
      failed: sql<number>`count(*) filter (where ${s.emailLog.status} = 'FAILED' or ${s.emailLog.delivery} = 'FAILED')`,
      opened: sql<number>`count(*) filter (where ${s.emailLog.openedAt} is not null)`,
      clicked: sql<number>`count(*) filter (where ${s.emailLog.clickedAt} is not null)`,
    })
    .from(s.emailLog)
    .where(sql`${s.emailLog.organizationId} = ${organizationId} and ${s.emailLog.createdAt} >= ${since.toISOString()}::timestamptz`);
  return { sent: Number(row?.sent ?? 0), delivered: Number(row?.delivered ?? 0), bounced: Number(row?.bounced ?? 0), complained: Number(row?.complained ?? 0), failed: Number(row?.failed ?? 0), opened: Number(row?.opened ?? 0), clicked: Number(row?.clicked ?? 0), days };
}
