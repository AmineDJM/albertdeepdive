import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { hashIp } from "@/server/auth/tokens";
import { checkLimit } from "@/server/billing/entitlements";

/**
 * Readers.
 *
 * Subscribing is double opt-in: signing somebody up creates a PENDING row and sends them a link;
 * nothing is sent to them until they click it. That is not only the law in most of the places
 * Briefly will be sold — it is also what keeps a workspace's sending reputation intact, since one
 * customer importing a bought list would otherwise poison delivery for everyone.
 *
 * Leaving is always one click and never requires signing in, so every email carries a stable
 * unguessable token rather than an address in a query string.
 */

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  locale: z.enum(["en", "fr"]).default("en"),
});

export type SubscribeInput = z.input<typeof subscribeSchema>;

function token() {
  return randomBytes(32).toString("base64url");
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function publicationBySubscribeSlug(slug: string) {
  const publication = await db.query.publications.findFirst({
    where: and(eq(s.publications.subscribeSlug, slug), eq(s.publications.isPublic, true)),
    with: { organization: true },
  });
  if (!publication || publication.status === "ARCHIVED") return null;
  return publication;
}

export type SubscribeResult = { status: "confirmation_sent" | "already_subscribed"; confirmToken?: string; subscriberId: string };

/**
 * Subscribe to a title.
 *
 * Deliberately says the same thing whether or not the address was already on the list: answering
 * "already subscribed" to a stranger would turn the form into a way of testing whether somebody
 * reads a given publication.
 */
export async function subscribe(publicationId: string, raw: SubscribeInput, meta?: { ip?: string | null; source?: string }): Promise<SubscribeResult> {
  const input = subscribeSchema.parse(raw);
  const publication = await db.query.publications.findFirst({ where: eq(s.publications.id, publicationId) });
  if (!publication) throw new NotFoundError("Publication");
  if (publication.status === "ARCHIVED" || !publication.isPublic) throw new ValidationError("This publication is not accepting subscribers");

  const organizationId = publication.organizationId;
  const existing = await db.query.subscribers.findFirst({
    where: and(eq(s.subscribers.organizationId, organizationId), eq(s.subscribers.email, input.email)),
  });

  // The limit is the publisher's, not the reader's, so the message says nothing about plans.
  if (!existing) {
    const room = await checkLimit(organizationId, "subscribers");
    if (!room.allowed) throw new ValidationError("This publication is not accepting new subscribers right now.");
  }

  const raw_token = token();
  const subscriber =
    existing ??
    (
      await db
        .insert(s.subscribers)
        .values({
          organizationId,
          email: input.email,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          locale: input.locale,
          status: "PENDING",
          source: meta?.source ?? "form",
          confirmTokenHash: hashToken(raw_token),
          confirmTokenExpiresAt: new Date(Date.now() + CONFIRM_TTL_MS),
          unsubscribeToken: token(),
          ipHash: hashIp(meta?.ip),
        })
        .returning()
    )[0];

  if (existing) {
    // Somebody who left and came back is a new consent, so they confirm again.
    const needsConfirmation = existing.status !== "SUBSCRIBED";
    if (needsConfirmation) {
      await db
        .update(s.subscribers)
        .set({
          status: "PENDING",
          confirmTokenHash: hashToken(raw_token),
          confirmTokenExpiresAt: new Date(Date.now() + CONFIRM_TTL_MS),
          firstName: input.firstName ?? existing.firstName,
          lastName: input.lastName ?? existing.lastName,
          locale: input.locale,
          unsubscribedAt: null,
        })
        .where(eq(s.subscribers.id, existing.id));
    } else {
      await linkSubscription(publicationId, existing.id);
      return { status: "already_subscribed", subscriberId: existing.id };
    }
  }

  await linkSubscription(publicationId, subscriber.id);
  await audit({ action: "subscriber.pending", organizationId, actorType: "SYSTEM", entityId: subscriber.id, metadata: { publicationId } });
  return { status: "confirmation_sent", confirmToken: raw_token, subscriberId: subscriber.id };
}

async function linkSubscription(publicationId: string, subscriberId: string) {
  await db
    .insert(s.publicationSubscriptions)
    .values({ publicationId, subscriberId, isActive: true })
    .onConflictDoUpdate({
      target: [s.publicationSubscriptions.publicationId, s.publicationSubscriptions.subscriberId],
      set: { isActive: true, unsubscribedAt: null },
    });
}

/** Confirm a subscription. The token is single-use: confirming clears it. */
export async function confirmSubscription(rawToken: string) {
  const hash = hashToken(rawToken);
  const subscriber = await db.query.subscribers.findFirst({ where: eq(s.subscribers.confirmTokenHash, hash) });
  if (!subscriber || !subscriber.confirmTokenHash || !safeEqual(subscriber.confirmTokenHash, hash)) throw new NotFoundError("Confirmation link");
  if (subscriber.confirmTokenExpiresAt && subscriber.confirmTokenExpiresAt.getTime() < Date.now()) {
    throw new ValidationError("This confirmation link has expired. Subscribe again to get a new one.");
  }
  const [row] = await db
    .update(s.subscribers)
    .set({ status: "SUBSCRIBED", confirmedAt: new Date(), confirmTokenHash: null, confirmTokenExpiresAt: null })
    .where(eq(s.subscribers.id, subscriber.id))
    .returning();
  await audit({ action: "subscriber.confirm", organizationId: row.organizationId, actorType: "SYSTEM", entityId: row.id });
  return row;
}

/** One click, no sign-in. `publicationId` leaves only that title; omitting it leaves everything. */
export async function unsubscribe(unsubscribeToken: string, publicationId?: string) {
  const subscriber = await db.query.subscribers.findFirst({ where: eq(s.subscribers.unsubscribeToken, unsubscribeToken) });
  if (!subscriber) throw new NotFoundError("Unsubscribe link");

  if (publicationId) {
    await db
      .update(s.publicationSubscriptions)
      .set({ isActive: false, unsubscribedAt: new Date() })
      .where(and(eq(s.publicationSubscriptions.subscriberId, subscriber.id), eq(s.publicationSubscriptions.publicationId, publicationId)));
    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*)` })
      .from(s.publicationSubscriptions)
      .where(and(eq(s.publicationSubscriptions.subscriberId, subscriber.id), eq(s.publicationSubscriptions.isActive, true)));
    if (Number(remaining) > 0) {
      await audit({ action: "subscriber.unsubscribe", organizationId: subscriber.organizationId, actorType: "SYSTEM", entityId: subscriber.id, metadata: { publicationId } });
      return { subscriber, remaining: Number(remaining) };
    }
  } else {
    await db.update(s.publicationSubscriptions).set({ isActive: false, unsubscribedAt: new Date() }).where(eq(s.publicationSubscriptions.subscriberId, subscriber.id));
  }

  await db.update(s.subscribers).set({ status: "UNSUBSCRIBED", unsubscribedAt: new Date() }).where(eq(s.subscribers.id, subscriber.id));
  await audit({ action: "subscriber.unsubscribe", organizationId: subscriber.organizationId, actorType: "SYSTEM", entityId: subscriber.id, metadata: { publicationId: publicationId ?? "all" } });
  return { subscriber, remaining: 0 };
}

/** Who an edition actually goes to: confirmed readers of its title, and nobody else. */
export async function recipientsFor(publicationId: string) {
  return db
    .select({
      id: s.subscribers.id,
      email: s.subscribers.email,
      firstName: s.subscribers.firstName,
      lastName: s.subscribers.lastName,
      locale: s.subscribers.locale,
      unsubscribeToken: s.subscribers.unsubscribeToken,
    })
    .from(s.publicationSubscriptions)
    .innerJoin(s.subscribers, eq(s.publicationSubscriptions.subscriberId, s.subscribers.id))
    .where(and(eq(s.publicationSubscriptions.publicationId, publicationId), eq(s.publicationSubscriptions.isActive, true), eq(s.subscribers.status, "SUBSCRIBED")));
}

export async function subscriberStats(organizationId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      subscribed: sql<number>`count(*) filter (where ${s.subscribers.status} = 'SUBSCRIBED')`,
      pending: sql<number>`count(*) filter (where ${s.subscribers.status} = 'PENDING')`,
      unsubscribed: sql<number>`count(*) filter (where ${s.subscribers.status} = 'UNSUBSCRIBED')`,
      bounced: sql<number>`count(*) filter (where ${s.subscribers.status} in ('BOUNCED','COMPLAINED'))`,
    })
    .from(s.subscribers)
    .where(eq(s.subscribers.organizationId, organizationId));
  return { total: Number(row.total), subscribed: Number(row.subscribed), pending: Number(row.pending), unsubscribed: Number(row.unsubscribed), bounced: Number(row.bounced) };
}

export async function markBounced(organizationId: string, email: string, complained = false) {
  await db
    .update(s.subscribers)
    .set({ status: complained ? "COMPLAINED" : "BOUNCED", bouncedAt: new Date() })
    .where(and(eq(s.subscribers.organizationId, organizationId), eq(s.subscribers.email, email.toLowerCase())));
}
