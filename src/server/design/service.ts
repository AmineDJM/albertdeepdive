import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { createLogger } from "@/server/logger";
import { composeDesign, unsupportedCompositions } from "@/lib/design/compose";
import { editionDesignSchema, type EditionDesign } from "@/lib/design/model";
import { isRenderable, validateDesign } from "@/lib/design/validate";
import { directEditionDesign, type DirectOptions } from "./director";

const logger = createLogger("design:service");

/**
 * Designing an edition, and keeping what was designed.
 *
 * The keeping matters as much as the designing. A published issue must stay reproducible (§94) and
 * "restore the previous design" must restore a design rather than re-run a generator that may now
 * answer differently — a model changed, a photograph was replaced, a font metric moved. So every
 * revision is a row, and the current one is marked rather than assumed.
 */

export type DesignResult = {
  design: EditionDesign;
  revision: number;
  /** What the director decided, in the editor's words. */
  narrative: string;
  source: "model" | "local";
  costCents: number;
};

/**
 * Read the edition, direct it, plan it, compose it, and store the result.
 *
 * The whole first pass, in the order §102 asks for. What it does not do is render — that is the
 * renderers' job, and keeping them out of here is what lets one design produce a page, a web
 * edition and an email that agree with each other.
 */
export async function designEdition(editionId: string, options: DirectOptions & { summary?: string } = {}): Promise<DesignResult> {
  const directed = await directEditionDesign(editionId, options);
  const design = composeDesign({
    editionId,
    document: directed.document,
    signals: directed.signals,
    direction: directed.direction,
    plan: directed.plan,
  });

  // Two checks before anything is stored, both of which answer "can this be drawn at all".
  const issues = validateDesign(design, directed.document);
  if (!isRenderable(issues)) {
    logger.error("composed a design that cannot be rendered", { editionId, issues: issues.filter((i) => i.severity === "error").slice(0, 5) });
    throw new Error(`The composed design is not renderable: ${issues.find((i) => i.severity === "error")?.message}`);
  }
  const unsupported = unsupportedCompositions(design, directed.signals);
  if (unsupported.length) logger.warn("compositions the material does not support", { editionId, unsupported: unsupported.slice(0, 5) });

  const saved = await saveDesign(editionId, design, { summary: options.summary ?? directed.plan.narrative, userId: options.userId ?? null });
  return { design: saved, revision: saved.revision, narrative: directed.plan.narrative, source: directed.source, costCents: directed.costCents };
}

/**
 * Store a design as the current revision, keeping every earlier one.
 *
 * The revision number comes from the database rather than from the design, because two people
 * revising at once must not both write revision 4 — the unique index would refuse the second, which
 * is the correct outcome and a confusing error, so the number is read inside the transaction.
 */
export async function saveDesign(editionId: string, design: EditionDesign, options: { summary?: string | null; userId?: string | null } = {}): Promise<EditionDesign> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition?.organizationId) throw new Error(`Edition ${editionId} not found`);

  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ revision: s.editionDesigns.revision })
      .from(s.editionDesigns)
      .where(eq(s.editionDesigns.editionId, editionId))
      .orderBy(desc(s.editionDesigns.revision))
      .limit(1);
    const revision = (latest?.revision ?? -1) + 1;
    const next = editionDesignSchema.parse({ ...design, revision });

    await tx.update(s.editionDesigns).set({ isCurrent: false }).where(and(eq(s.editionDesigns.editionId, editionId), eq(s.editionDesigns.isCurrent, true)));
    await tx.insert(s.editionDesigns).values({
      organizationId: edition.organizationId!,
      editionId,
      revision,
      design: next,
      summary: options.summary ?? null,
      engine: next.engine,
      isCurrent: true,
      createdById: options.userId ?? null,
    });
    return next;
  });
}

/** The design an edition is currently composed as, or nothing if it has never been designed. */
export async function currentDesign(editionId: string): Promise<EditionDesign | null> {
  const row = await db.query.editionDesigns.findFirst({
    where: await scoped(s.editionDesigns.organizationId, eq(s.editionDesigns.editionId, editionId), eq(s.editionDesigns.isCurrent, true)),
  });
  return row ? editionDesignSchema.parse(row.design) : null;
}

/** One particular revision, for "restore this" and for comparing two. */
export async function designRevision(editionId: string, revision: number): Promise<EditionDesign | null> {
  const row = await db.query.editionDesigns.findFirst({
    where: await scoped(s.editionDesigns.organizationId, eq(s.editionDesigns.editionId, editionId), eq(s.editionDesigns.revision, revision)),
  });
  return row ? editionDesignSchema.parse(row.design) : null;
}

/** What has been designed, newest first: the history a person scrolls and restores from. */
export async function designHistory(editionId: string, limit = 20) {
  return db.query.editionDesigns.findMany({
    where: await scoped(s.editionDesigns.organizationId, eq(s.editionDesigns.editionId, editionId)),
    orderBy: [desc(s.editionDesigns.revision)],
    limit,
    columns: { id: true, revision: true, summary: true, engine: true, isCurrent: true, createdAt: true, createdById: true },
  });
}

/**
 * Put an earlier revision back, as a new revision.
 *
 * Restoring by rewriting history would make "what did we send" unanswerable. So a restore is a new
 * revision whose content happens to be an old one, and the trail reads as what actually happened.
 */
export async function restoreDesign(editionId: string, revision: number, options: { userId?: string | null } = {}): Promise<EditionDesign> {
  const old = await designRevision(editionId, revision);
  if (!old) throw new Error(`Edition ${editionId} has no revision ${revision}`);
  return saveDesign(editionId, old, { summary: `Restored the design from revision ${revision}`, userId: options.userId ?? null });
}
