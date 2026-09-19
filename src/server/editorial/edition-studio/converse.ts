import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { createLogger } from "@/server/logger";
import { planEditionChange } from "@/server/ai/services/edition-studio";
import { editionOperationSchema, asksFirst, summarise, type EditionOperation } from "./operations";
import { executeOperations, type OperationOutcome } from "./execute";
import { createRestorePoint, restore } from "./restore";
import { buildSnapshot, snapshotForPrompt, type StudioSnapshot } from "./snapshot";

const log = createLogger("edition-studio");

/** How much of the thread the planner is given. Enough to be a conversation, not enough to be a bill. */
const HISTORY_TURNS = 12;

export type StudioTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  operations: EditionOperation[];
  outcomes: OperationOutcome[];
  pendingOperations: EditionOperation[];
  mediaAssetIds: string[];
  restorePointId: string | null;
  pagesBefore: number | null;
  pagesAfter: number | null;
  createdAt: string;
};

export type StudioReply = { turns: StudioTurn[]; snapshot: StudioSnapshot };

function toTurn(row: typeof s.editionStudioMessages.$inferSelect): StudioTurn {
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    operations: (row.operations ?? []) as EditionOperation[],
    outcomes: (row.outcomes ?? []) as OperationOutcome[],
    pendingOperations: (row.pendingOperations ?? []) as EditionOperation[],
    mediaAssetIds: row.mediaAssetIds ?? [],
    restorePointId: row.restorePointId,
    pagesBefore: row.pagesBefore,
    pagesAfter: row.pagesAfter,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listTurns(editionId: string, limit = 60): Promise<StudioTurn[]> {
  const rows = await db
    .select()
    .from(s.editionStudioMessages)
    .where(eq(s.editionStudioMessages.editionId, editionId))
    .orderBy(desc(s.editionStudioMessages.createdAt))
    .limit(limit);
  return rows.reverse().map(toTurn);
}

async function organizationOf(editionId: string): Promise<string | null> {
  const row = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), columns: { organizationId: true } });
  if (!row) throw new NotFoundError("Edition");
  return row.organizationId;
}

/**
 * One turn: read the issue, plan, do the safe part, say what happened.
 *
 * The operations the planner marks — or the vocabulary marks — as asking first are not run. They are
 * kept on the assistant's turn so the interface can offer them as a button, which is a clearer yes
 * than a typed one: nobody re-plans an issue by accident because they wrote "ok" to something else.
 */
export async function converse(
  editionId: string,
  input: { message: string; mediaAssetIds?: string[] },
  userId: string,
): Promise<StudioReply> {
  const message = input.message.trim();
  if (!message) throw new ValidationError("Say something first");
  const organizationId = await organizationOf(editionId);
  const before = await buildSnapshot(editionId);
  const history = await listTurns(editionId, HISTORY_TURNS);
  const pendingFromLast = history.length ? history[history.length - 1].pendingOperations : [];

  const mediaIds = input.mediaAssetIds ?? [];
  const attachedMedia = mediaIds.length
    ? await db.select({ id: s.mediaAssets.id, fileName: s.mediaAssets.fileName, caption: s.mediaAssets.caption }).from(s.mediaAssets).where(eq(s.mediaAssets.editionId, editionId))
    : [];
  const attached = attachedMedia.filter((m) => mediaIds.includes(m.id));

  await db.insert(s.editionStudioMessages).values({
    editionId,
    organizationId,
    role: "user",
    content: message,
    mediaAssetIds: mediaIds,
    createdById: userId,
    pagesBefore: before.edition.pages,
  });

  const planned = await planEditionChange(
    {
      snapshot: snapshotForPrompt(before),
      history: history.map((t) => ({ role: t.role, content: t.content })),
      message,
      attachedMedia: attached,
      pending: pendingFromLast,
    },
    { editionId, entityType: "EDITION", entityId: editionId, cacheable: false },
  );

  // The schema already validated the shape; this keeps only what the vocabulary still recognises
  // after a prompt edit or a model that improvised a field.
  const operations: EditionOperation[] = [];
  for (const raw of planned.output.operations) {
    const parsed = editionOperationSchema.safeParse(raw);
    if (parsed.success) operations.push(parsed.data);
    else log.warn("studio dropped an operation it could not read", { editionId, issue: parsed.error.issues[0]?.message });
  }

  const hold = operations.filter((op) => asksFirst(op));
  const now = operations.filter((op) => !asksFirst(op));

  let restorePointId: string | null = null;
  let outcomes: OperationOutcome[] = [];
  if (now.length) {
    restorePointId = await createRestorePoint(editionId, now, now.map(summarise).join(" · "), userId);
    outcomes = await executeOperations(editionId, now, userId);
  }

  const after = outcomes.some((o) => o.ok) ? await buildSnapshot(editionId) : before;

  await db.insert(s.editionStudioMessages).values({
    editionId,
    organizationId,
    role: "assistant",
    content: planned.output.reply,
    operations: now,
    outcomes,
    pendingOperations: hold,
    restorePointId,
    aiJobId: planned.aiJobId,
    createdById: userId,
    pagesBefore: before.edition.pages,
    pagesAfter: after.edition.pages,
  });

  return { turns: await listTurns(editionId), snapshot: after };
}

/** Runs what a turn held back, once somebody has said yes to it in as many words. */
export async function applyPending(editionId: string, messageId: string, userId: string): Promise<StudioReply> {
  const row = await db.query.editionStudioMessages.findFirst({
    where: and(eq(s.editionStudioMessages.id, messageId), eq(s.editionStudioMessages.editionId, editionId)),
  });
  if (!row) throw new NotFoundError("Message");
  const pending = ((row.pendingOperations ?? []) as unknown[]).map((raw) => editionOperationSchema.safeParse(raw)).flatMap((r) => (r.success ? [r.data] : []));
  if (!pending.length) throw new ValidationError("There is nothing waiting on this turn");

  const before = await buildSnapshot(editionId);
  const restorePointId = await createRestorePoint(editionId, pending, pending.map(summarise).join(" · "), userId);
  const outcomes = await executeOperations(editionId, pending, userId);
  const after = await buildSnapshot(editionId);

  await db.update(s.editionStudioMessages).set({ pendingOperations: [] }).where(eq(s.editionStudioMessages.id, messageId));
  await db.insert(s.editionStudioMessages).values({
    editionId,
    organizationId: await organizationOf(editionId),
    role: "assistant",
    content: outcomes.every((o) => o.ok) ? "Done." : "Done, with one that would not go through.",
    operations: pending,
    outcomes,
    restorePointId,
    createdById: userId,
    pagesBefore: before.edition.pages,
    pagesAfter: after.edition.pages,
  });
  return { turns: await listTurns(editionId), snapshot: after };
}

/** Puts the issue back to what it was before a turn, and says so in the thread. */
export async function undoTurn(editionId: string, messageId: string, userId: string): Promise<StudioReply> {
  const row = await db.query.editionStudioMessages.findFirst({
    where: and(eq(s.editionStudioMessages.id, messageId), eq(s.editionStudioMessages.editionId, editionId)),
  });
  if (!row?.restorePointId) throw new ValidationError("There is nothing to undo on this turn");
  const point = await restore(editionId, row.restorePointId, userId);
  const after = await buildSnapshot(editionId);
  await db.insert(s.editionStudioMessages).values({
    editionId,
    organizationId: await organizationOf(editionId),
    role: "assistant",
    content: `Put back the way it was: ${point.label}`,
    createdById: userId,
    pagesAfter: after.edition.pages,
  });
  return { turns: await listTurns(editionId), snapshot: after };
}

/** The opening state of the panel: the thread so far and the issue as it stands. */
export async function studioState(editionId: string): Promise<StudioReply> {
  const [turns, snapshot] = await Promise.all([listTurns(editionId), buildSnapshot(editionId)]);
  return { turns, snapshot };
}

