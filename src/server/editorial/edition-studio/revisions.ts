import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, max } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { createLogger } from "@/server/logger";
import { audit } from "@/server/audit";
import { requireRevision, revisionAllowance, type RevisionAllowance } from "@/server/billing/entitlements";
import { runCopyfitPass } from "@/server/publication/flatplan";
import { requestExport } from "@/server/publication/versions";
import { asksFirst, describe, summarise, supersedes, type EditionOperation, type OperationNames } from "./operations";
import { executeOperations, type OperationOutcome } from "./execute";
import { createRestorePoint, restore } from "./restore";
import { buildSnapshot, type StudioSnapshot } from "./snapshot";

const log = createLogger("edition-studio");

/**
 * Revisions: the unit a customer is sold, and the unit the work is done in.
 *
 * Applying a change to an issue that already exists is not cheap. The layout is re-planned and
 * re-measured, the PDF and the DOCX are rendered again, and a film made from the copy is no longer
 * a film of what the issue says. Doing that once per sentence would be both slow and, on a metered
 * plan, expensive in a way nobody agreed to.
 *
 * So the conversation does not apply anything. It fills a basket, the person reads the list, takes
 * out whatever they did not mean, and presses once. That press is the revision: one restore point,
 * one run, one re-fit, one re-render, one deduction from the plan's allowance for this issue.
 */

export const REVISION_STATUSES = ["DRAFT", "APPLYING", "APPLIED", "FAILED"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/** One line of the basket. Kept with its own id so a single line can be taken out again. */
export type StagedChange = {
  id: string;
  op: EditionOperation;
  /** English sentence with `{placeholders}`, looked up in the interface's dictionary. */
  text: string;
  values?: Record<string, string | number>;
  /**
   * Worth a second look before it is bought: re-planning discards an arrangement somebody may have
   * spent an afternoon on, and taking a page out takes its story off the paper. The basket is the
   * confirmation, so these are marked in the list rather than asked about separately — one thing to
   * understand instead of two.
   */
  notable: boolean;
  /** The turn of the conversation that proposed it, so the basket links back to the ask. */
  messageId: string | null;
  addedAt: string;
};

/** What became of a format once the revision had run. */
export type RerenderOutcome = { subject: string; ok: boolean; detail: string };

export type RevisionView = {
  id: string;
  number: number | null;
  status: RevisionStatus;
  changes: StagedChange[];
  outcomes: OperationOutcome[];
  rerenders: RerenderOutcome[];
  restorePointId: string | null;
  pagesBefore: number | null;
  pagesAfter: number | null;
  error: string | null;
  appliedAt: string | null;
  createdAt: string;
};

export type RevisionState = {
  /** The open basket, or null when nothing is waiting. */
  draft: RevisionView | null;
  /** Revisions already spent on this issue, newest first. */
  history: RevisionView[];
  allowance: RevisionAllowance;
};

type RevisionRow = typeof s.editionRevisions.$inferSelect;

function toView(row: RevisionRow): RevisionView {
  return {
    id: row.id,
    number: row.number,
    status: (REVISION_STATUSES as readonly string[]).includes(row.status) ? (row.status as RevisionStatus) : "DRAFT",
    changes: (row.changes ?? []) as StagedChange[],
    outcomes: (row.outcomes ?? []) as OperationOutcome[],
    rerenders: (row.rerenders ?? []) as RerenderOutcome[],
    restorePointId: row.restorePointId,
    pagesBefore: row.pagesBefore,
    pagesAfter: row.pagesAfter,
    error: row.error,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function organizationOf(editionId: string): Promise<string | null> {
  const row = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), columns: { organizationId: true } });
  if (!row) throw new NotFoundError("Edition");
  return row.organizationId;
}

/** Headlines and page numbers for the ids an operation carries, so the basket reads as sentences. */
export function namesFrom(snapshot: StudioSnapshot): OperationNames {
  const articles: Record<string, string> = {};
  const stories: Record<string, string> = {};
  const pages: Record<string, number> = {};
  for (const a of snapshot.articles) articles[a.id] = a.headline;
  for (const p of snapshot.pages) {
    pages[p.id] = p.number;
    for (const st of p.stories) stories[st.id] = st.title;
  }
  return { articles, stories, pages };
}

/**
 * The open basket for this issue, created on first use.
 *
 * Two people talking to the same issue at once would both find no basket and both make one; the
 * index that allows a single open basket per issue is what stops that, and this is the other half
 * of it — the loser of the race takes the basket the winner made rather than failing.
 */
export async function openDraft(editionId: string, userId: string | null): Promise<RevisionRow> {
  const find = () =>
    db.query.editionRevisions.findFirst({ where: and(eq(s.editionRevisions.editionId, editionId), eq(s.editionRevisions.status, "DRAFT")) });
  const existing = await find();
  if (existing) return existing;
  const [row] = await db
    .insert(s.editionRevisions)
    .values({ editionId, organizationId: await organizationOf(editionId), status: "DRAFT", createdById: userId })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const raced = await find();
  if (!raced) throw new ValidationError("The list could not be opened");
  return raced;
}

/**
 * Adds what a turn proposed to the basket.
 *
 * An operation that plainly replaces one already waiting takes its place rather than sitting beside
 * it: asked for 24 pages and then for 28, the basket says 28 once. Anything else is appended, in
 * the order it was asked for, because that is the order it will run in.
 */
export async function stage(
  editionId: string,
  ops: EditionOperation[],
  options: { messageId?: string | null; names?: OperationNames; userId: string | null },
): Promise<{ revisionId: string; changes: StagedChange[]; added: StagedChange[]; replaced: number }> {
  const draft = await openDraft(editionId, options.userId);
  const current = (draft.changes ?? []) as StagedChange[];
  const kept: StagedChange[] = [...current];
  const added: StagedChange[] = [];
  let replaced = 0;

  for (const op of ops) {
    const phrase = describe(op, options.names ?? {});
    const change: StagedChange = {
      id: randomUUID(),
      op,
      text: phrase.text,
      values: phrase.values,
      notable: asksFirst(op),
      messageId: options.messageId ?? null,
      addedAt: new Date().toISOString(),
    };
    for (let i = kept.length - 1; i >= 0; i--) {
      if (supersedes(op, kept[i].op)) {
        kept.splice(i, 1);
        replaced++;
      }
    }
    kept.push(change);
    added.push(change);
  }

  await db.update(s.editionRevisions).set({ changes: kept }).where(eq(s.editionRevisions.id, draft.id));
  return { revisionId: draft.id, changes: kept, added, replaced };
}

/** Takes one line out of the basket before it costs anything. */
export async function removeChange(editionId: string, changeId: string, userId: string | null): Promise<RevisionView> {
  const draft = await openDraft(editionId, userId);
  const current = (draft.changes ?? []) as StagedChange[];
  const next = current.filter((c) => c.id !== changeId);
  if (next.length === current.length) throw new NotFoundError("Change");
  const [row] = await db.update(s.editionRevisions).set({ changes: next }).where(eq(s.editionRevisions.id, draft.id)).returning();
  return toView(row);
}

/** Empties the basket. Nothing has run, so there is nothing to undo. */
export async function discardDraft(editionId: string, userId: string | null): Promise<RevisionView> {
  const draft = await openDraft(editionId, userId);
  const [row] = await db.update(s.editionRevisions).set({ changes: [] }).where(eq(s.editionRevisions.id, draft.id)).returning();
  await audit({ action: "revision.discard", userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { revisionId: draft.id } });
  return toView(row);
}

/**
 * Does anything in this basket change what is on the paper?
 *
 * Used to decide whether one re-fit is owed at the end. A basket of headline rewrites changes the
 * copy and therefore the fit; a basket that only leaves notes on pages changes neither.
 */
function affectsPaper(ops: EditionOperation[]): boolean {
  return ops.some((op) => op.kind !== "set_page_notes");
}

function alreadyRefits(ops: EditionOperation[]): boolean {
  return ops.some((op) => op.kind === "copyfit" || op.kind === "regenerate_layout");
}

/**
 * What the revision leaves out of date, and what it can put right by itself.
 *
 * The web page and the email are built from the issue when they are read or sent, so they carry the
 * new version without being asked. The PDF and the print files are frozen artefacts, so a fresh
 * export is queued for them. A film is neither: re-cutting one costs real money at a provider, so
 * it is reported as out of date rather than silently re-made — that is a decision, not a side
 * effect of pressing Apply.
 */
async function refreshOutputs(editionId: string, userId: string | null): Promise<RerenderOutcome[]> {
  const results: RerenderOutcome[] = [];
  const outputs = await db.select().from(s.editionOutputs).where(eq(s.editionOutputs.editionId, editionId));

  const frozen = outputs.filter((o) => (o.format === "MAGAZINE" || o.format === "PRINT") && o.status !== "PUBLISHED");
  if (frozen.length) {
    try {
      // One export serves both: a version renders the PDF and the DOCX from the same document.
      const { version } = await requestExport(editionId, { kind: "DRAFT", userId, notes: "Re-made after a revision" });
      for (const output of frozen) {
        await db.update(s.editionOutputs).set({ status: "PENDING", versionId: version.id, lastError: null }).where(eq(s.editionOutputs.id, output.id));
        results.push({ subject: output.format, ok: true, detail: `Being made again as ${version.label}.` });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.warn("revision could not queue a fresh export", { editionId, error });
      for (const output of frozen) results.push({ subject: output.format, ok: false, detail: error });
    }
  }
  for (const output of outputs.filter((o) => (o.format === "MAGAZINE" || o.format === "PRINT") && o.status === "PUBLISHED")) {
    results.push({ subject: output.format, ok: false, detail: "Already published, so this version stays as it went out." });
  }
  for (const output of outputs.filter((o) => o.format === "WEB")) {
    results.push({
      subject: "WEB",
      ok: true,
      detail: output.status === "PUBLISHED" ? "The page is built when it is read, so it shows the new version already." : "Will be built from the new version when it is published.",
    });
  }
  for (const output of outputs.filter((o) => o.format === "EMAIL")) {
    results.push({
      subject: "EMAIL",
      ok: output.status !== "PUBLISHED",
      detail: output.status === "PUBLISHED" ? "Already sent — a revision cannot change what is in somebody's inbox." : "Will be built from the new version when it is sent.",
    });
  }

  const films = await db
    .select({ id: s.creativePacks.id })
    .from(s.creativePacks)
    .where(and(eq(s.creativePacks.editionId, editionId), eq(s.creativePacks.status, "READY")));
  if (films.length) {
    results.push({
      subject: "CREATIVE",
      ok: false,
      detail: `${films.length} creative pack(s) were made from the old copy. Making them again costs credits, so they are left as they are until you ask.`,
    });
  }
  return results;
}

/**
 * Spends one revision.
 *
 * The allowance is checked here, on the server, before anything runs — the button being hidden is a
 * courtesy. Everything after that is one batch: one restore point for the lot, the operations in
 * the order they were asked for, one re-fit at the end rather than one per change, and then the
 * formats.
 *
 * A revision that fails is still a revision that ran, so it is recorded as FAILED with what went
 * wrong — but it is not counted against the allowance, which only counts APPLIED. Being charged for
 * a re-edit that did not happen is the kind of thing that ends a relationship.
 */
export async function applyRevision(editionId: string, userId: string): Promise<{ revision: RevisionView; snapshot: StudioSnapshot; allowance: RevisionAllowance }> {
  const draft = await openDraft(editionId, userId);
  const changes = (draft.changes ?? []) as StagedChange[];
  if (!changes.length) throw new ValidationError("There is nothing waiting to be applied");

  const organizationId = await organizationOf(editionId);
  if (organizationId) await requireRevision(organizationId, editionId);

  const ops = changes.map((c) => c.op);
  const before = await buildSnapshot(editionId);
  await db.update(s.editionRevisions).set({ status: "APPLYING", pagesBefore: before.edition.pages, error: null }).where(eq(s.editionRevisions.id, draft.id));

  let outcomes: OperationOutcome[] = [];
  let rerenders: RerenderOutcome[] = [];
  let restorePointId: string | null = null;
  try {
    restorePointId = await createRestorePoint(editionId, ops, changes.map((c) => summarise(c.op)).join(" · "), userId);
    outcomes = await executeOperations(editionId, ops, userId);
    if (outcomes.some((o) => o.ok) && affectsPaper(ops) && !alreadyRefits(ops)) {
      // The point of gathering changes up: the issue is measured and re-fitted once for all of them.
      try {
        const report = await runCopyfitPass(editionId, userId);
        rerenders.push({ subject: "LAYOUT", ok: true, detail: `Re-measured: ${report.pages} pages.` });
      } catch (err) {
        rerenders.push({ subject: "LAYOUT", ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    }
    rerenders = [...rerenders, ...(await refreshOutputs(editionId, userId))];
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error("revision failed", { editionId, revisionId: draft.id, error });
    const [failed] = await db
      .update(s.editionRevisions)
      .set({ status: "FAILED", outcomes, rerenders, restorePointId, error })
      .where(eq(s.editionRevisions.id, draft.id))
      .returning();
    throw Object.assign(err instanceof Error ? err : new Error(error), { revisionId: failed.id });
  }

  const after = await buildSnapshot(editionId);
  const [{ highest } = { highest: null }] = await db
    .select({ highest: max(s.editionRevisions.number) })
    .from(s.editionRevisions)
    .where(and(eq(s.editionRevisions.editionId, editionId), isNotNull(s.editionRevisions.number)));

  const [row] = await db
    .update(s.editionRevisions)
    .set({
      status: "APPLIED",
      number: Number(highest ?? 0) + 1,
      outcomes,
      rerenders,
      restorePointId,
      pagesAfter: after.edition.pages,
      appliedAt: new Date(),
      appliedById: userId,
    })
    .where(eq(s.editionRevisions.id, draft.id))
    .returning();

  await audit({
    action: "revision.apply",
    organizationId,
    userId,
    entityType: "EDITION",
    entityId: editionId,
    editionId,
    metadata: { revisionId: row.id, number: row.number, changes: changes.length, applied: outcomes.filter((o) => o.ok).length, pagesBefore: before.edition.pages, pagesAfter: after.edition.pages },
  });

  return {
    revision: toView(row),
    snapshot: after,
    allowance: organizationId ? await revisionAllowance(organizationId, editionId) : { used: 0, limit: null, remaining: null, allowed: true },
  };
}

/**
 * Puts the issue back to before a revision ran.
 *
 * The revision stays in the history as something that happened, and it stays counted: the work was
 * done and the renders were made. Undoing is a judgement about the result, not a refund.
 */
export async function undoRevision(editionId: string, revisionId: string, userId: string): Promise<{ revision: RevisionView; snapshot: StudioSnapshot }> {
  const row = await db.query.editionRevisions.findFirst({
    where: and(eq(s.editionRevisions.id, revisionId), eq(s.editionRevisions.editionId, editionId)),
  });
  if (!row) throw new NotFoundError("Revision");
  if (!row.restorePointId) throw new ValidationError("This revision kept nothing that can be put back");
  await restore(editionId, row.restorePointId, userId);
  const snapshot = await buildSnapshot(editionId);
  await db.update(s.editionRevisions).set({ pagesAfter: snapshot.edition.pages }).where(eq(s.editionRevisions.id, row.id));
  return { revision: toView({ ...row, pagesAfter: snapshot.edition.pages }), snapshot };
}

/** The basket, what has already been spent on this issue, and how much is left. */
export async function revisionState(editionId: string): Promise<RevisionState> {
  const [rows, organizationId] = await Promise.all([
    db.select().from(s.editionRevisions).where(eq(s.editionRevisions.editionId, editionId)).orderBy(desc(s.editionRevisions.createdAt)),
    organizationOf(editionId),
  ]);
  const draft = rows.find((r) => r.status === "DRAFT" || r.status === "APPLYING") ?? null;
  const history = rows.filter((r) => r.status === "APPLIED" || r.status === "FAILED").map(toView);
  return {
    draft: draft ? toView(draft) : null,
    history,
    allowance: organizationId ? await revisionAllowance(organizationId, editionId) : { used: 0, limit: null, remaining: null, allowed: true },
  };
}
