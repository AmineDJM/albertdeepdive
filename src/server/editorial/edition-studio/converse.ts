import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { createLogger } from "@/server/logger";
import { planEditionChange } from "@/server/ai/services/edition-studio";
import { editionOperationSchema, type EditionOperation } from "./operations";
import { namesFrom, revisionState, stage, type RevisionState, type StagedChange } from "./revisions";
import { buildSnapshot, snapshotForPrompt, type StudioSnapshot } from "./snapshot";

const log = createLogger("edition-studio");

/** How much of the thread the planner is given. Enough to be a conversation, not enough to be a bill. */
const HISTORY_TURNS = 12;

export type StudioTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  operations: EditionOperation[];
  /** The ids this turn put in the basket, so a line can be traced back to the sentence that asked. */
  stagedChangeIds: string[];
  mediaAssetIds: string[];
  createdAt: string;
};

export type StudioReply = { turns: StudioTurn[]; snapshot: StudioSnapshot; revisions: RevisionState };

function toTurn(row: typeof s.editionStudioMessages.$inferSelect): StudioTurn {
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    operations: (row.operations ?? []) as EditionOperation[],
    stagedChangeIds: (row.pendingOperations ?? []) as string[],
    mediaAssetIds: row.mediaAssetIds ?? [],
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
 * One turn: read the issue, work out what is being asked, put it in the basket, say what is in it.
 *
 * Nothing is applied here, and that is the whole design. Re-running an issue is the expensive act —
 * the layout, every format, any film — so it happens once, when the person presses Apply, and not
 * once per sentence. The conversation's job is to turn "elle est beaucoup trop dense" into a line
 * somebody can read and agree with before it costs them a revision.
 */
export async function converse(
  editionId: string,
  input: { message: string; mediaAssetIds?: string[] },
  userId: string,
): Promise<StudioReply> {
  const message = input.message.trim();
  if (!message) throw new ValidationError("Say something first");
  const organizationId = await organizationOf(editionId);
  const snapshot = await buildSnapshot(editionId);
  const history = await listTurns(editionId, HISTORY_TURNS);
  const waiting = (await revisionState(editionId)).draft?.changes ?? [];

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
    pagesBefore: snapshot.edition.pages,
  });

  const planned = await planEditionChange(
    {
      snapshot: snapshotForPrompt(snapshot),
      history: history.map((t) => ({ role: t.role, content: t.content })),
      message,
      attachedMedia: attached,
      waiting: waiting.map((c) => c.op),
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

  const [assistantTurn] = await db
    .insert(s.editionStudioMessages)
    .values({
      editionId,
      organizationId,
      role: "assistant",
      content: planned.output.reply,
      operations,
      aiJobId: planned.aiJobId,
      createdById: userId,
      pagesBefore: snapshot.edition.pages,
    })
    .returning({ id: s.editionStudioMessages.id });

  let staged: StagedChange[] = [];
  if (operations.length) {
    const result = await stage(editionId, operations, { messageId: assistantTurn.id, names: namesFrom(snapshot), userId });
    staged = result.added;
    await db
      .update(s.editionStudioMessages)
      .set({ pendingOperations: staged.map((c) => c.id) })
      .where(eq(s.editionStudioMessages.id, assistantTurn.id));
  }

  return { turns: await listTurns(editionId), snapshot, revisions: await revisionState(editionId) };
}

/** The opening state of the panel: the thread, the issue as it stands, and what is waiting to be applied. */
export async function studioState(editionId: string): Promise<StudioReply> {
  const [turns, snapshot, revisions] = await Promise.all([listTurns(editionId), buildSnapshot(editionId), revisionState(editionId)]);
  return { turns, snapshot, revisions };
}
