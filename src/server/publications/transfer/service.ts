import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";

/**
 * Handing a newsletter to somebody else.
 *
 * A newsletter is the thing that has an audience, a name, a look, a library and a list of people
 * who write for it. Moving it between workspaces is therefore not an administrative edit — it
 * changes who is responsible for a mailing list that agreed to hear from a particular publication.
 * So neither side does it alone: the owner proves they hold the mailbox the newsletter belongs to,
 * and the receiving workspace's admin address proves somebody there agreed to take it. A
 * newsletter arriving unannounced, with its subscribers and its sending reputation attached, is
 * not a gift.
 *
 * What moves and what does not is the other half of the design. Everything that hangs off the
 * title moves with it: its editions and every row that belongs to one, its identity — the look —
 * and the subscriptions and contributor links that name it. The people behind those links are the
 * subtle case. A reader who only ever subscribed to this newsletter moves; one who also reads
 * another title of the workspace being left behind is *copied*, because moving them would
 * unsubscribe them from something they never agreed to leave.
 */

const CODE_TTL_MINUTES = 30;
const MAX_ATTEMPTS = 5;

/** Six digits, from the system's own randomness rather than Math.random. */
function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

/** Compared in constant time: a code checked with `===` leaks its prefix through timing. */
function codeMatches(code: string, expected: string): boolean {
  const a = Buffer.from(hashCode(code), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type TransferPreview = {
  publicationId: string;
  publicationName: string;
  editions: number;
  subscribers: number;
  contributors: number;
};

/** What would move, counted before anybody is asked to confirm anything. */
export async function previewTransfer(publicationId: string, organizationId: string): Promise<TransferPreview> {
  const publication = await db.query.publications.findFirst({
    where: and(eq(s.publications.id, publicationId), eq(s.publications.organizationId, organizationId)),
    columns: { id: true, name: true },
  });
  if (!publication) throw new NotFoundError("Publication");

  const [[editions], [readers], [writers]] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(s.editions).where(eq(s.editions.publicationId, publicationId)),
    db.select({ n: sql<number>`count(*)` }).from(s.publicationSubscriptions).where(and(eq(s.publicationSubscriptions.publicationId, publicationId), eq(s.publicationSubscriptions.isActive, true))),
    db.select({ n: sql<number>`count(*)` }).from(s.publicationContributors).where(eq(s.publicationContributors.publicationId, publicationId)),
  ]);

  return {
    publicationId,
    publicationName: publication.name,
    editions: Number(editions?.n ?? 0),
    subscribers: Number(readers?.n ?? 0),
    contributors: Number(writers?.n ?? 0),
  };
}

export type StartedTransfer = {
  transferId: string;
  ownerEmail: string;
  recipientEmail: string;
  /** The two codes, returned once so the caller can post them. Never stored in the clear. */
  ownerCode: string;
  recipientCode: string;
  expiresAt: Date;
  preview: TransferPreview;
};

/**
 * Opens a handover. Nothing moves here: two codes go out and both have to come back.
 */
export async function startTransfer(input: {
  publicationId: string;
  fromOrganizationId: string;
  toOrganizationId: string;
  requestedById: string;
  ownerEmail: string;
  now?: Date;
}): Promise<StartedTransfer> {
  const now = input.now ?? new Date();
  if (input.fromOrganizationId === input.toOrganizationId) {
    throw new ValidationError("This newsletter is already in that workspace.");
  }
  const preview = await previewTransfer(input.publicationId, input.fromOrganizationId);

  const destination = await db.query.organizations.findFirst({
    where: eq(s.organizations.id, input.toOrganizationId),
    columns: { id: true, name: true, status: true },
  });
  if (!destination) throw new NotFoundError("Organization");
  if (destination.status !== "ACTIVE") throw new ValidationError("That workspace cannot receive a newsletter right now.");

  // Somebody at the other end has to be able to say yes, and it has to be somebody who could
  // already act for that workspace — not an address typed into this form.
  const admin = await db
    .select({ email: s.users.email })
    .from(s.organizationMembers)
    .innerJoin(s.users, eq(s.users.id, s.organizationMembers.userId))
    .where(and(eq(s.organizationMembers.organizationId, input.toOrganizationId), inArray(s.organizationMembers.role, ["OWNER", "ADMIN"]), eq(s.users.isActive, true)))
    .orderBy(s.organizationMembers.role)
    .limit(1);
  const recipientEmail = admin[0]?.email;
  if (!recipientEmail) throw new ValidationError("That workspace has no owner or administrator to confirm the transfer.");

  // One live handover per newsletter: two in flight would race to move the same rows.
  const existing = await db.query.publicationTransfers.findFirst({
    where: and(eq(s.publicationTransfers.publicationId, input.publicationId), eq(s.publicationTransfers.status, "PENDING")),
  });
  if (existing && existing.expiresAt > now) throw new ValidationError("A transfer of this newsletter is already waiting for its codes.");
  if (existing) await db.update(s.publicationTransfers).set({ status: "EXPIRED" }).where(eq(s.publicationTransfers.id, existing.id));

  const ownerCode = newCode();
  const recipientCode = newCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);

  const [row] = await db
    .insert(s.publicationTransfers)
    .values({
      publicationId: input.publicationId,
      fromOrganizationId: input.fromOrganizationId,
      toOrganizationId: input.toOrganizationId,
      requestedById: input.requestedById,
      ownerEmail: input.ownerEmail,
      recipientEmail,
      ownerCodeHash: hashCode(ownerCode),
      recipientCodeHash: hashCode(recipientCode),
      expiresAt,
    })
    .returning();

  await audit({
    action: "publication.transfer.start",
    organizationId: input.fromOrganizationId,
    userId: input.requestedById,
    entityId: input.publicationId,
    metadata: { to: destination.name, editions: preview.editions, subscribers: preview.subscribers },
  });

  return { transferId: row.id, ownerEmail: input.ownerEmail, recipientEmail, ownerCode, recipientCode, expiresAt, preview };
}

/**
 * Both codes at once, because the owner types both: one from their own inbox, one read to them by
 * whoever is receiving. Checking them separately would let somebody brute-force them separately.
 */
export async function confirmTransfer(input: {
  transferId: string;
  fromOrganizationId: string;
  ownerCode: string;
  recipientCode: string;
  userId?: string | null;
  now?: Date;
}): Promise<{ moved: Record<string, number> }> {
  const now = input.now ?? new Date();
  const transfer = await db.query.publicationTransfers.findFirst({ where: eq(s.publicationTransfers.id, input.transferId) });
  if (!transfer) throw new NotFoundError("Transfer");
  // Scoped: a transfer id is not a capability, the workspace it belongs to is.
  if (transfer.fromOrganizationId !== input.fromOrganizationId) throw new NotFoundError("Transfer");
  if (transfer.status !== "PENDING") throw new ValidationError("This transfer is already finished.");
  if (transfer.expiresAt <= now) {
    await db.update(s.publicationTransfers).set({ status: "EXPIRED" }).where(eq(s.publicationTransfers.id, transfer.id));
    throw new ValidationError("The codes have expired. Start the transfer again.");
  }
  if (transfer.attempts >= MAX_ATTEMPTS) {
    await db.update(s.publicationTransfers).set({ status: "CANCELLED", cancelledAt: now }).where(eq(s.publicationTransfers.id, transfer.id));
    throw new ForbiddenError("Too many wrong codes. The transfer has been cancelled.");
  }

  const ownerOk = codeMatches(input.ownerCode, transfer.ownerCodeHash);
  const recipientOk = codeMatches(input.recipientCode, transfer.recipientCodeHash);
  if (!ownerOk || !recipientOk) {
    await db.update(s.publicationTransfers).set({ attempts: transfer.attempts + 1 }).where(eq(s.publicationTransfers.id, transfer.id));
    // Which one was wrong is not said: naming it halves the work of guessing the pair.
    throw new ValidationError(`That does not match. ${MAX_ATTEMPTS - transfer.attempts - 1} attempts left.`);
  }

  const moved = await moveEverything(transfer.publicationId, transfer.fromOrganizationId, transfer.toOrganizationId);

  await db
    .update(s.publicationTransfers)
    .set({ status: "COMPLETED", ownerConfirmedAt: now, recipientConfirmedAt: now, completedAt: now, moved })
    .where(eq(s.publicationTransfers.id, transfer.id));

  // Recorded in both workspaces: the one that lost it and the one that has it now.
  for (const organizationId of [transfer.fromOrganizationId, transfer.toOrganizationId]) {
    await audit({ action: "publication.transfer.complete", organizationId, userId: input.userId, entityId: transfer.publicationId, metadata: moved });
  }
  return { moved };
}

export async function cancelTransfer(transferId: string, fromOrganizationId: string, userId?: string | null): Promise<void> {
  const transfer = await db.query.publicationTransfers.findFirst({ where: eq(s.publicationTransfers.id, transferId) });
  if (!transfer || transfer.fromOrganizationId !== fromOrganizationId) throw new NotFoundError("Transfer");
  if (transfer.status !== "PENDING") return;
  await db.update(s.publicationTransfers).set({ status: "CANCELLED", cancelledAt: new Date() }).where(eq(s.publicationTransfers.id, transferId));
  await audit({ action: "publication.transfer.cancel", organizationId: fromOrganizationId, userId, entityId: transfer.publicationId });
}

/**
 * Every table that stamps an organisation *and* hangs off an edition.
 *
 * Both columns, not one. A row reached only through its edition — a section, a campaign, a story —
 * follows the edition for free, because nothing reads it by organisation. A row that carries an
 * organisation of its own is read under it, so leaving the old one behind makes the row invisible
 * to its own newsletter: that is how a moved edition arrives without its pictures.
 *
 * Taken from the database rather than from memory: `select` the tables that have both columns and
 * this is the list, audit log and platform tables aside. Those two stay where the events happened —
 * an audit entry records something a workspace did, and moving it would rewrite that workspace's
 * history.
 */
const EDITION_SCOPED: { table: string; }[] = [
  { table: "ai_jobs" },
  { table: "automation_runs" },
  { table: "creative_packs" },
  { table: "design_messages" },
  { table: "edition_art_directions" },
  { table: "edition_designs" },
  { table: "edition_outputs" },
  { table: "edition_revisions" },
  { table: "edition_studio_messages" },
  { table: "edition_studio_restore_points" },
  { table: "email_log" },
  { table: "image_versions" },
  { table: "jobs" },
  { table: "media_assets" },
  { table: "narrations" },
  { table: "qc_runs" },
];

/**
 * The move itself, in one transaction.
 *
 * Re-stamping `organization_id` rather than copying rows: the newsletter keeps its identity, its
 * history and every id anybody has a link to. A copy would give the audience a second publication
 * to be subscribed to and leave the first one behind.
 */
async function moveEverything(publicationId: string, from: string, to: string): Promise<Record<string, number>> {
  return db.transaction(async (tx) => {
    const editions = await tx.select({ id: s.editions.id }).from(s.editions).where(eq(s.editions.publicationId, publicationId));
    const editionIds = editions.map((e) => e.id);

    await tx.update(s.publications).set({ organizationId: to }).where(eq(s.publications.id, publicationId));
    await tx.update(s.publicationIdentities).set({ organizationId: to }).where(eq(s.publicationIdentities.publicationId, publicationId));
    if (editionIds.length) {
      await tx.update(s.editions).set({ organizationId: to }).where(inArray(s.editions.id, editionIds));
      for (const { table } of EDITION_SCOPED) {
        // Raw because the list is heterogeneous: sixteen Drizzle tables with nothing in common in
        // the type system but two column names. The names are checked by the test that reads them
        // back out of the schema, which is a stronger guarantee than a cast would be.
        await tx.execute(
          // Each id bound on its own: an array parameter expands to a record tuple, not an array.
          sql`update ${sql.identifier(table)} set organization_id = ${to}::uuid where edition_id in (${sql.join(editionIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
        );
      }
    }

    // ── The audience ────────────────────────────────────────────────────────────────────────
    // A reader who only ever subscribed to this newsletter goes with it. One who also reads
    // another title of the workspace being left behind is copied instead: moving them would
    // unsubscribe them from something they never agreed to leave.
    const readers = await tx
      .select({ subscriberId: s.publicationSubscriptions.subscriberId })
      .from(s.publicationSubscriptions)
      .where(eq(s.publicationSubscriptions.publicationId, publicationId));
    let movedReaders = 0;
    let copiedReaders = 0;
    for (const { subscriberId } of readers) {
      const [elsewhere] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(s.publicationSubscriptions)
        .where(and(eq(s.publicationSubscriptions.subscriberId, subscriberId), ne(s.publicationSubscriptions.publicationId, publicationId)));
      if (Number(elsewhere?.n ?? 0) === 0) {
        await tx.update(s.subscribers).set({ organizationId: to }).where(eq(s.subscribers.id, subscriberId));
        movedReaders += 1;
        continue;
      }
      const original = await tx.query.subscribers.findFirst({ where: eq(s.subscribers.id, subscriberId) });
      if (!original) continue;
      // Everything about the reader except what identifies the row and the workspace it was in.
      const rest = { ...original } as Partial<typeof original>;
      delete rest.id;
      delete rest.organizationId;
      delete rest.createdAt;
      delete rest.updatedAt;
      const [copy] = await tx.insert(s.subscribers).values({ ...(rest as typeof original), organizationId: to }).returning({ id: s.subscribers.id });
      await tx
        .update(s.publicationSubscriptions)
        .set({ subscriberId: copy.id })
        .where(and(eq(s.publicationSubscriptions.publicationId, publicationId), eq(s.publicationSubscriptions.subscriberId, subscriberId)));
      copiedReaders += 1;
    }

    // ── The people who write for it ─────────────────────────────────────────────────────────
    const writers = await tx
      .select({ contributorId: s.publicationContributors.contributorId })
      .from(s.publicationContributors)
      .where(eq(s.publicationContributors.publicationId, publicationId));
    let movedWriters = 0;
    let copiedWriters = 0;
    for (const { contributorId } of writers) {
      const [elsewhere] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(s.publicationContributors)
        .where(and(eq(s.publicationContributors.contributorId, contributorId), ne(s.publicationContributors.publicationId, publicationId)));
      if (Number(elsewhere?.n ?? 0) === 0) {
        // A contributor's campus belongs to the workspace they are leaving, so it does not follow.
        await tx.update(s.contributors).set({ organizationId: to, campusId: null }).where(eq(s.contributors.id, contributorId));
        movedWriters += 1;
      } else {
        copiedWriters += 1;
      }
    }

    return {
      editions: editionIds.length,
      subscribersMoved: movedReaders,
      subscribersCopied: copiedReaders,
      contributorsMoved: movedWriters,
      contributorsShared: copiedWriters,
    };
  });
}

/** The handover waiting on this newsletter, if there is one. */
export async function pendingTransfer(publicationId: string, organizationId: string) {
  const row = await db.query.publicationTransfers.findFirst({
    where: and(
      eq(s.publicationTransfers.publicationId, publicationId),
      eq(s.publicationTransfers.fromOrganizationId, organizationId),
      eq(s.publicationTransfers.status, "PENDING"),
      isNull(s.publicationTransfers.completedAt),
    ),
  });
  if (!row || row.expiresAt <= new Date()) return null;
  // The codes never leave the database, not even to the screen that is waiting for them.
  return { id: row.id, ownerEmail: row.ownerEmail, recipientEmail: row.recipientEmail, expiresAt: row.expiresAt, attempts: row.attempts, maxAttempts: MAX_ATTEMPTS };
}
