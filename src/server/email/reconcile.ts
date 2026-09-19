import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { parseResendEvent } from "./providers/resend";
import { deliveryFrom } from "./events";

/**
 * What the provider said, replayed against what Briefly wrote down.
 *
 * A webhook is an at-least-once promise, which is another way of saying it is an at-most-never
 * promise: an endpoint that was down for ten minutes, a deploy mid-delivery, a row whose message id
 * arrived before the send finished writing it — all of them end with a log that is quietly wrong
 * about whether somebody received the newsletter. Nothing in the product notices, because every
 * screen reads the same wrong column.
 *
 * So the events are kept whole, and this replays them: fold the provider's own payloads through the
 * same state machine the live handler uses and compare where it lands with where the row sits.
 * Using `deliveryFrom` rather than a second opinion about what a soft bounce means is the point —
 * a reimplementation would disagree with the handler on every row instead of on the drifted ones.
 *
 * The provider is authoritative here. Briefly's column is a cache of somebody else's fact, which is
 * why re-applying it is a repair and not an editorial decision.
 */

type Delivery = (typeof s.emailDeliveryEnum.enumValues)[number];

export type Drift = {
  logId: string;
  to: string;
  /** What the log says today. */
  logged: Delivery;
  /** Where replaying the provider's own events lands. */
  reported: Delivery;
  events: number;
};

export type Reconciliation = {
  checked: number;
  drifted: Drift[];
  /** Sent through a reporting provider over a day ago and never reported on at all. */
  unconfirmed: number;
  unconfirmedSample: string[];
};

/** Providers that report back. Mail sent through somebody's mailbox never will, and is not counted. */
const REPORTING = ["resend"];

const WINDOW_DAYS = 30;
const MAX_ROWS = 2000;

/**
 * Compare the log with the provider's events for one workspace.
 *
 * Bounded by a window rather than by a sample: a sample that finds nothing proves nothing, and the
 * events are already local, so the whole recent window costs one query rather than one request per
 * message.
 */
export async function deliveryDrift(organizationId: string, options: { days?: number; now?: Date } = {}): Promise<Reconciliation> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - (options.days ?? WINDOW_DAYS) * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: s.emailLog.id, to: s.emailLog.to, delivery: s.emailLog.delivery, sentAt: s.emailLog.sentAt })
    .from(s.emailLog)
    .where(
      and(
        eq(s.emailLog.organizationId, organizationId),
        isNotNull(s.emailLog.providerMessageId),
        inArray(s.emailLog.provider, REPORTING),
        gte(s.emailLog.createdAt, since),
      ),
    )
    .orderBy(asc(s.emailLog.createdAt))
    .limit(MAX_ROWS);
  if (!rows.length) return { checked: 0, drifted: [], unconfirmed: 0, unconfirmedSample: [] };

  const ids = rows.map((row) => row.id);
  const events = await db
    .select({ emailLogId: s.emailEvents.emailLogId, providerEventId: s.emailEvents.providerEventId, payload: s.emailEvents.payload })
    .from(s.emailEvents)
    .where(inArray(s.emailEvents.emailLogId, ids))
    .orderBy(asc(s.emailEvents.occurredAt));

  const byLog = new Map<string, typeof events>();
  for (const event of events) {
    if (!event.emailLogId) continue;
    const list = byLog.get(event.emailLogId) ?? [];
    list.push(event);
    byLog.set(event.emailLogId, list);
  }

  const drifted: Drift[] = [];
  const unconfirmedSample: string[] = [];
  let unconfirmed = 0;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const row of rows) {
    const list = byLog.get(row.id) ?? [];
    if (!list.length) {
      // Nothing ever came back. Only counted once the provider has had a day to say something,
      // because a message sent four minutes ago has not been delivered yet either way.
      if (row.sentAt && row.sentAt < yesterday) {
        unconfirmed += 1;
        if (unconfirmedSample.length < 5) unconfirmedSample.push(row.to);
      }
      continue;
    }
    let state: Delivery = "PENDING";
    for (const stored of list) {
      const event = parseResendEvent(stored.payload, stored.providerEventId);
      if (!event) continue;
      const next = deliveryFrom(event, state);
      if (next) state = next;
    }
    if (state !== row.delivery) drifted.push({ logId: row.id, to: row.to, logged: row.delivery, reported: state, events: list.length });
  }

  return { checked: rows.length, drifted, unconfirmed, unconfirmedSample };
}

/**
 * Write the provider's version back into the log.
 *
 * Only the column the replay is authoritative about, plus the timestamp that column implies, so a
 * repair cannot invent an open that never happened. Returns how many rows actually moved.
 */
export async function applyDrift(drifted: Drift[], now: Date = new Date()): Promise<number> {
  let applied = 0;
  for (const drift of drifted) {
    const patch: Partial<typeof s.emailLog.$inferInsert> = { delivery: drift.reported };
    if (drift.reported === "DELIVERED") patch.deliveredAt = sql`coalesce(${s.emailLog.deliveredAt}, ${now.toISOString()}::timestamptz)` as unknown as Date;
    if (["BOUNCED", "COMPLAINED", "SUPPRESSED"].includes(drift.reported)) {
      patch.bouncedAt = sql`coalesce(${s.emailLog.bouncedAt}, ${now.toISOString()}::timestamptz)` as unknown as Date;
    }
    const done = await db.update(s.emailLog).set(patch).where(eq(s.emailLog.id, drift.logId)).returning({ id: s.emailLog.id });
    applied += done.length;
  }
  return applied;
}

/** Messages sent through a reporting provider that never got a message id back, which is its own bug. */
export async function unidentifiedSends(organizationId: string, days = WINDOW_DAYS, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(s.emailLog)
    .where(
      and(
        eq(s.emailLog.organizationId, organizationId),
        inArray(s.emailLog.provider, REPORTING),
        isNull(s.emailLog.providerMessageId),
        eq(s.emailLog.status, "SENT"),
        gte(s.emailLog.createdAt, since),
        lt(s.emailLog.createdAt, now),
      ),
    );
  return Number(row?.n ?? 0);
}
