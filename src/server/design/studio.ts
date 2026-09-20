import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { createLogger } from "@/server/logger";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { planDesignChange } from "@/server/ai/services/design-studio";
import { readSignals } from "@/lib/design/signals";
import { describeDirection } from "@/lib/design/identity";
import { blocksOf, findBlock, type EditionDesign } from "@/lib/design/model";
import { COMPOSITIONS, type BlockRole } from "@/lib/design/roles";
import { applyOperations, type OperationOutcome } from "@/lib/design/apply";
import { describeDiff, diffDesigns } from "@/lib/design/diff";
import { asksFirst, designOperationSchema, type DesignOperation } from "@/lib/design/operations";
import { currentDesign, designEdition, designRevision, restoreDesign, saveDesign } from "./service";
import { directionFor } from "./identity";

const log = createLogger("design:studio");

/**
 * The conversation an art director has with a design.
 *
 * One turn does four things: read the design as it stands, work out what was asked, carry out what
 * can be carried out, and say what happened. Everything the model proposes is checked twice — once
 * against the vocabulary, which cannot express anything else, and once against this design, which
 * either has that block or does not.
 *
 * A turn that changes something produces a revision. A turn that changes nothing produces none,
 * because a history full of "no change" entries is a history nobody reads.
 */

/** How much of the thread the model is given. Enough to be a conversation, not enough to be a bill. */
const HISTORY_TURNS = 12;

export type DesignTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  selection: string[];
  operations: DesignOperation[];
  outcomes: { what: string; done: boolean }[];
  revisionBefore: number | null;
  revisionAfter: number | null;
  createdAt: string;
};

export type DesignReply = {
  turns: DesignTurn[];
  design: EditionDesign;
  revision: number;
  /** What this turn changed, in the words an editor would use. */
  changed: string;
  /** True when the model asked for something to be confirmed rather than doing it. */
  awaiting: boolean;
};

function toTurn(row: typeof s.designMessages.$inferSelect): DesignTurn {
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    selection: row.selection ?? [],
    operations: (row.operations ?? []) as DesignOperation[],
    outcomes: (row.outcomes ?? []) as { what: string; done: boolean }[],
    revisionBefore: row.revisionBefore,
    revisionAfter: row.revisionAfter,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listDesignTurns(editionId: string, limit = 60): Promise<DesignTurn[]> {
  const rows = await db.query.designMessages.findMany({
    where: await scoped(s.designMessages.organizationId, eq(s.designMessages.editionId, editionId)),
    orderBy: [desc(s.designMessages.createdAt)],
    limit,
  });
  return rows.reverse().map(toTurn);
}

/**
 * The design, written out for a model to reason about.
 *
 * Ids first, because an operation names one, and then only what a decision could turn on: what the
 * block is, how it is drawn, how much it weighs, whether it has a photograph and whether somebody
 * has held it. Not the text — the model is deciding how an issue looks, not what it says.
 */
export function writeDesign(design: EditionDesign, headlines: Map<string, string>): string {
  const lines: string[] = [];
  for (const section of design.sections) {
    lines.push(`# ${section.name}`);
    for (const surface of section.surfaces) {
      lines.push(`  ${surface.id} · ${surface.kind}${surface.intent ? ` · ${surface.intent}` : ""}`);
      for (const block of surface.blocks) {
        const held = block.locked ? " · held" : block.lockedAspects.length ? ` · held: ${block.lockedAspects.join(",")}` : "";
        const picture = block.elements.some((element) => element.content.kind === "media") ? " · has a photograph" : "";
        const headline = block.articleId ? headlines.get(block.articleId) : null;
        lines.push(`    ${block.id} · ${block.role} · ${block.composition} · ${block.importance}${picture}${held}${headline ? ` · “${headline}”` : ""}`);
      }
    }
  }
  return lines.join("\n");
}

function writeVocabulary(design: EditionDesign): string {
  const roles = [...new Set(blocksOf(design).map((block) => block.role))];
  return roles.map((role) => `${role}: ${COMPOSITIONS[role as BlockRole].join(", ")}`).join("\n");
}

/**
 * One turn.
 *
 * The selection is what makes "this" mean anything: a person points at a block and says "not like
 * that", and the sentence is meaningless without knowing what they were pointing at. It is stored
 * with the turn for the same reason.
 */
export async function talkToDesign(
  editionId: string,
  input: { message: string; selection?: string[] },
  userId: string,
): Promise<DesignReply> {
  const message = input.message.trim();
  if (!message) throw new ValidationError("Say something first");

  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition?.organizationId) throw new NotFoundError("Edition");
  const organizationId = edition.organizationId;

  const existing = await currentDesign(editionId);
  const design = existing ?? (await designEdition(editionId)).design;
  const selection = (input.selection ?? []).filter((id) => findBlock(design, id));

  const [document, { resolved: direction }] = await Promise.all([
    buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true }),
    directionFor(editionId),
  ]);
  const signals = readSignals(document);
  const headlines = new Map(document.articles.map((article) => [article.id, article.headline]));

  await db.insert(s.designMessages).values({
    organizationId,
    editionId,
    role: "user",
    content: message,
    selection,
    revisionBefore: design.revision,
    createdById: userId,
  });

  const history = (await listDesignTurns(editionId, HISTORY_TURNS)).map((turn) => ({ role: turn.role, content: turn.content }));
  const planned = await planDesignChange(
    {
      design: writeDesign(design, headlines),
      intent: describeDirection(direction),
      selection: selection.length ? selection.map((id) => `${id} (${findBlock(design, id)?.role})`).join(", ") : "",
      history: history.slice(0, -1),
      message,
      vocabulary: writeVocabulary(design),
    },
    { editionId, entityType: "EDITION", entityId: editionId },
  );

  // Checked twice: the vocabulary cannot express anything else, and this design either has that
  // block or does not. Anything that fails either check is dropped before it can run.
  const operations: DesignOperation[] = [];
  for (const candidate of planned.output.operations) {
    const parsed = designOperationSchema.safeParse(candidate);
    if (!parsed.success) continue;
    operations.push(parsed.data);
  }

  const heavy = operations.filter((operation) => asksFirst(operation));
  const restore = operations.find((operation) => operation.kind === "restore_revision");

  let next = design;
  let outcomes: OperationOutcome[] = [];
  let revision = design.revision;
  let changed = "Nothing changed.";
  const awaiting = planned.output.askFirst && heavy.length > 0;

  if (!awaiting && operations.length) {
    if (restore && restore.kind === "restore_revision") {
      const older = await designRevision(editionId, restore.revision);
      if (older) {
        const put = await restoreDesign(editionId, restore.revision, { userId });
        next = put;
        revision = put.revision;
        outcomes = [{ operation: restore, done: true, what: `the design from revision ${restore.revision} is back` }];
        changed = describeDiff(diffDesigns(design, put));
      } else {
        outcomes = [{ operation: restore, done: false, what: `there is no revision ${restore.revision}` }];
      }
    } else {
      const applied = applyOperations(design, operations, { signals, direction });
      outcomes = applied.outcomes;
      if (applied.outcomes.some((outcome) => outcome.done)) {
        const diff = diffDesigns(design, applied.design);
        changed = describeDiff(diff);
        const saved = await saveDesign(editionId, applied.design, { summary: changed, userId });
        next = saved;
        revision = saved.revision;
      }
    }
  }

  const refused = outcomes.filter((outcome) => !outcome.done);
  const reply = [
    planned.output.reply,
    awaiting && heavy.length ? `Before I do that: ${heavy.map((operation) => operation.kind.replace(/_/g, " ")).join(", ")}. Say yes and I will.` : null,
    refused.length ? `I could not ${refused.map((outcome) => outcome.what).join("; ")}.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  await db.insert(s.designMessages).values({
    organizationId,
    editionId,
    role: "assistant",
    content: reply,
    selection,
    operations,
    outcomes: outcomes.map((outcome) => ({ what: outcome.what, done: outcome.done })),
    revisionBefore: design.revision,
    revisionAfter: revision,
    aiJobId: planned.aiJobId ?? null,
    createdById: userId,
  });

  log.info("design turn", { editionId, operations: operations.length, applied: outcomes.filter((outcome) => outcome.done).length, revision });
  return { turns: await listDesignTurns(editionId), design: next, revision, changed, awaiting };
}
