import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { createLogger } from "@/server/logger";
import { planEditionChange } from "@/server/ai/services/edition-studio";
import { editionOperationSchema, type EditionOperation } from "./operations";
import { applyRevision, namesFrom, revisionState, stage, type RevisionState, type StagedChange } from "./revisions";
import { buildSnapshot, snapshotForPrompt, type StudioSnapshot } from "./snapshot";

const log = createLogger("edition-studio");

/** How much of the thread the planner is given. Enough to be a conversation, not enough to be a bill. */
const HISTORY_TURNS = 12;

/** What a turn did. "confirm" is the one that makes the next "yes" mean something. */
export type StudioIntent = "stage" | "confirm" | "apply";

export type StudioTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  operations: EditionOperation[];
  /** The ids this turn put on the list, so a line can be traced back to the sentence that asked. */
  stagedChangeIds: string[];
  mediaAssetIds: string[];
  intent: StudioIntent | null;
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
    intent: (["stage", "confirm", "apply"] as const).includes(row.intent as StudioIntent) ? (row.intent as StudioIntent) : null,
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
 * One turn: read the issue, work out what is being asked, put it on the list — and run it when
 * that is what was asked.
 *
 * Talking and pressing are the same instruction said two ways. "Applique" spends the revision
 * exactly as the button does, through the same service, with the same allowance check; telling
 * somebody who just said "vas-y" to go and click something is an interface pretending it did not
 * hear. What the conversation does not do is decide on its own that now is the moment: `apply` is
 * set only for an explicit go-ahead, and the one case that still asks twice is a list carrying an
 * operation the vocabulary marks as heavy — re-planning the issue, taking a page out — which is
 * named in a sentence and applied on the next yes.
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
  // The last thing Briefly said decides what "yes" means now.
  const asked = [...history].reverse().find((turn) => turn.role === "assistant")?.intent === "confirm";

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
      confirming: asked,
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
      intent: "stage",
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

  if (planned.output.apply) await runFromConversation(editionId, assistantTurn.id, organizationId, userId, asked);

  return { turns: await listTurns(editionId), snapshot: await buildSnapshot(editionId), revisions: await revisionState(editionId) };
}

/**
 * "Apply it", carried out.
 *
 * Exactly the path the button takes — `applyRevision`, allowance checked inside it — because two
 * ways of saying the same thing must not be two pieces of code that can drift apart. What the
 * conversation adds is the one extra question: a list carrying something the vocabulary marks as
 * heavy is named rather than run, once, and the answer to that question arrives here with
 * `alreadyAsked` set.
 */
async function runFromConversation(
  editionId: string,
  turnId: string,
  organizationId: string | null,
  userId: string,
  alreadyAsked: boolean,
): Promise<void> {
  const draft = (await revisionState(editionId)).draft;
  const changes = draft?.changes ?? [];
  const say = async (content: string, intent: StudioIntent, pagesAfter?: number) => {
    await db.insert(s.editionStudioMessages).values({ editionId, organizationId, role: "assistant", content, createdById: userId, intent, pagesAfter });
  };

  if (!changes.length) {
    await say("There is nothing waiting on this issue, so there is nothing to apply.", "stage");
    return;
  }

  const heavy = changes.filter((change) => change.notable);
  if (heavy.length && !alreadyAsked) {
    const list = heavy.map((change) => `“${fill(change.text, change.values)}”`).join(", ");
    await db.update(s.editionStudioMessages).set({ intent: "confirm" }).where(eq(s.editionStudioMessages.id, turnId));
    await say(`Before I spend the revision: ${list} ${heavy.length === 1 ? "is" : "are"} on the list, and that cannot be undone by carrying on — only by putting the issue back afterwards. Say yes and I will run all of it.`, "confirm");
    return;
  }

  try {
    const result = await applyRevision(editionId, userId);
    const done = result.revision.outcomes.filter((outcome) => outcome.ok).length;
    const failed = result.revision.outcomes.length - done;
    const pages =
      result.revision.pagesBefore !== null && result.revision.pagesAfter !== null && result.revision.pagesBefore !== result.revision.pagesAfter
        ? ` The issue went from ${result.revision.pagesBefore} to ${result.revision.pagesAfter} pages.`
        : "";
    const left =
      result.allowance.limit === null ? "" : ` ${result.allowance.remaining} revision${result.allowance.remaining === 1 ? "" : "s"} left on this issue.`;
    await say(
      failed
        ? `Revision ${result.revision.number} is done: ${done} change${done === 1 ? "" : "s"} made, ${failed} that would not go through.${pages}${left}`
        : `Revision ${result.revision.number} is done: ${done} change${done === 1 ? "" : "s"} made.${pages}${left}`,
      "apply",
      result.snapshot.edition.pages,
    );
  } catch (err) {
    // A refusal is an answer, and it belongs in the thread where the instruction was given rather
    // than only in a toast the person may already have scrolled past.
    const reason = err instanceof Error ? err.message : String(err);
    log.warn("studio could not apply from the conversation", { editionId, reason });
    await say(`I could not apply it: ${reason}`, "stage");
  }
}

/** The same substitution the interface makes, for a sentence Briefly has to say out loud. */
function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** The opening state of the panel: the thread, the issue as it stands, and what is waiting to be applied. */
export async function studioState(editionId: string): Promise<StudioReply> {
  const [turns, snapshot, revisions] = await Promise.all([listTurns(editionId), buildSnapshot(editionId), revisionState(editionId)]);
  return { turns, snapshot, revisions };
}
