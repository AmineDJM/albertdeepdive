import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { articles, facts, quotes, stories, submissions, type ArticleBlock } from "@/server/db/schema";
import { audit, recordDecision } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { blockText } from "@/lib/publication/document";
import { containment, sentenceOverlap } from "@/lib/editorial/text";

export type FactRow = typeof facts.$inferSelect;

export async function listFacts(storyId: string, options: { includeRejected?: boolean } = {}): Promise<FactRow[]> {
  const rows = await db.query.facts.findMany({ where: eq(facts.storyId, storyId), orderBy: [asc(facts.createdAt)] });
  return options.includeRejected ? rows : rows.filter((f) => f.status !== "REJECTED");
}

async function loadFact(factId: string) {
  const fact = await db.query.facts.findFirst({ where: eq(facts.id, factId) });
  if (!fact) throw new NotFoundError("Fact");
  return fact;
}

/** Marks a fact as checked by an editor. Disputed facts must go through resolveConflict. */
export async function verifyFact(factId: string, userId: string) {
  const fact = await loadFact(factId);
  if (fact.status === "DISPUTED") throw new ValidationError("This fact is disputed: resolve the conflict instead of verifying it.");
  const [row] = await db
    .update(facts)
    .set({ confidence: "EDITOR_VERIFIED", status: fact.status === "REJECTED" ? "ACTIVE" : fact.status, verifiedById: userId, verifiedAt: new Date() })
    .where(eq(facts.id, factId))
    .returning();
  await recordDecision({ editionId: fact.editionId, entityType: "FACT", entityId: factId, decision: "FACT_VERIFY", previousValue: { confidence: fact.confidence, status: fact.status }, newValue: { confidence: "EDITOR_VERIFIED" }, userId });
  return row;
}

export async function rejectFact(factId: string, userId: string, reason?: string | null) {
  const fact = await loadFact(factId);
  const [row] = await db
    .update(facts)
    .set({ status: "REJECTED", notes: reason ? [fact.notes, reason].filter(Boolean).join("\n") : fact.notes, verifiedById: userId, verifiedAt: new Date() })
    .where(eq(facts.id, factId))
    .returning();
  await recordDecision({ editionId: fact.editionId, entityType: "FACT", entityId: factId, decision: "FACT_REJECT", reason: reason ?? null, previousValue: { status: fact.status }, newValue: { status: "REJECTED" }, userId });
  return row;
}

/**
 * Resolves a factual conflict: the kept fact becomes RESOLVED (editor verified), the other one is
 * rejected. Both must be DISPUTED (or share the conflict group). A single disputed fact may be
 * resolved on its own by passing the same id twice.
 */
export async function resolveConflict(factId: string, keepFactId: string, reason: string, userId: string) {
  if (!reason?.trim()) throw new ValidationError("A reason is required to resolve a conflict", { reason: ["Required"] });
  const fact = await loadFact(factId);
  const keep = factId === keepFactId ? fact : await loadFact(keepFactId);
  const group = [fact, keep].filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i);
  if (!group.some((f) => f.status === "DISPUTED")) throw new ValidationError("Neither fact is disputed");
  const related = fact.conflictGroup
    ? await db.query.facts.findMany({ where: and(eq(facts.conflictGroup, fact.conflictGroup), eq(facts.status, "DISPUTED")) })
    : fact.conflictsWithFactId
      ? await db.query.facts.findMany({ where: inArray(facts.id, [fact.conflictsWithFactId]) })
      : [];
  const losers = [...group, ...related].filter((f) => f.id !== keep.id).map((f) => f.id);
  const now = new Date();
  const [kept] = await db
    .update(facts)
    .set({ status: "RESOLVED", confidence: "EDITOR_VERIFIED", verifiedById: userId, verifiedAt: now, notes: [keep.notes, `Resolved: ${reason}`].filter(Boolean).join("\n") })
    .where(eq(facts.id, keep.id))
    .returning();
  if (losers.length) {
    await db
      .update(facts)
      .set({ status: "REJECTED", verifiedById: userId, verifiedAt: now, notes: `Rejected in favour of ${keep.id}: ${reason}` })
      .where(inArray(facts.id, [...new Set(losers)]));
  }
  await recordDecision({ editionId: fact.editionId, entityType: "FACT", entityId: keep.id, decision: "FACT_RESOLVE_CONFLICT", reason, previousValue: { disputed: [fact.id, ...losers] }, newValue: { kept: keep.id, rejected: losers }, userId });
  return { kept, rejected: [...new Set(losers)] };
}

/**
 * Settles a disputed fact that has no rival row — the common case when the pipeline flags a single
 * statement as uncertain ("spelled 'Sarfaty' in one source and 'Serfaty' in another"). The editor
 * writes the reading that is correct and why; the fact becomes editor-verified, and the wording
 * they chose is the wording the article and the print edition use.
 */
export async function settleFact(factId: string, statement: string, reason: string, userId: string) {
  const settled = statement?.trim();
  if (!settled) throw new ValidationError("The settled statement is required", { statement: ["Required"] });
  if (!reason?.trim()) throw new ValidationError("A reason is required to settle a disputed fact", { reason: ["Required"] });
  const fact = await loadFact(factId);
  if (fact.status !== "DISPUTED") throw new ValidationError("That fact is not disputed");
  const now = new Date();
  const [kept] = await db
    .update(facts)
    .set({ statement: settled, status: "RESOLVED", confidence: "EDITOR_VERIFIED", verifiedById: userId, verifiedAt: now, notes: [fact.notes, `Settled: ${reason.trim()}`].filter(Boolean).join("\n") })
    .where(eq(facts.id, factId))
    .returning();
  await recordDecision({
    editionId: fact.editionId,
    entityType: "FACT",
    entityId: factId,
    decision: "FACT_RESOLVE_CONFLICT",
    reason: reason.trim(),
    previousValue: { statement: fact.statement, status: fact.status },
    newValue: { statement: settled, status: "RESOLVED" },
    userId,
  });
  return kept;
}

export async function addFact(storyId: string, input: { statement: string; sourceSubmissionId?: string | null; category?: string | null; excerpt?: string | null }, userId: string) {
  const statement = input.statement?.trim();
  if (!statement) throw new ValidationError("Statement is required", { statement: ["Required"] });
  const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId), columns: { id: true, editionId: true, clusterId: true } });
  if (!story) throw new NotFoundError("Story");
  if (input.sourceSubmissionId) {
    const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, input.sourceSubmissionId), columns: { id: true, editionId: true } });
    if (!sub || sub.editionId !== story.editionId) throw new ValidationError("The source submission does not belong to this edition");
  }
  const [row] = await db
    .insert(facts)
    .values({
      editionId: story.editionId,
      storyId,
      clusterId: story.clusterId,
      statement,
      category: input.category ?? "other",
      sourceSubmissionId: input.sourceSubmissionId ?? null,
      sourceExcerpt: input.excerpt ?? null,
      confidence: input.sourceSubmissionId ? "STATED_BY_CONTRIBUTOR" : "EDITOR_VERIFIED",
      status: "ACTIVE",
      createdByAi: false,
      verifiedById: input.sourceSubmissionId ? null : userId,
      verifiedAt: input.sourceSubmissionId ? null : new Date(),
    })
    .returning();
  await audit({ action: "fact.add", userId, entityType: "FACT", entityId: row.id, editionId: story.editionId, metadata: { storyId } });
  return row;
}

export type BlockExplanation = {
  block: ArticleBlock | null;
  facts: FactRow[];
  submissions: { id: string; title: string; contributorName: string | null; storyType: string; excerpt: string | null }[];
  quotes: (typeof quotes.$inferSelect)[];
  note: string | null;
};

/** "Why is this sentence here?": the facts, submissions and quotes behind one article block. */
export async function explainBlock(articleId: string, blockId: string): Promise<BlockExplanation> {
  const article = await db.query.articles.findFirst({ where: eq(articles.id, articleId) });
  if (!article) throw new NotFoundError("Article");
  const block = article.body.find((b) => b.id === blockId) ?? null;
  const provenance = article.provenance[blockId];
  const text = block ? blockText(block) : "";
  const storyFacts = await db.query.facts.findMany({ where: eq(facts.storyId, article.storyId) });
  const storyQuotes = await db.query.quotes.findMany({ where: eq(quotes.storyId, article.storyId) });

  const factIds = new Set(provenance?.factIds ?? []);
  const submissionIds = new Set(provenance?.submissionIds ?? (block && "sources" in block ? (block.sources ?? []) : []));
  // Fall back to text overlap when the provenance is missing (manually written blocks).
  if (!factIds.size && text) {
    for (const f of storyFacts) {
      if (f.status === "REJECTED") continue;
      if (sentenceOverlap(text, f.statement) >= 0.35 || containment(f.statement, text) >= 0.7) factIds.add(f.id);
    }
  }
  const matchedFacts = storyFacts.filter((f) => factIds.has(f.id));
  for (const f of matchedFacts) if (f.sourceSubmissionId) submissionIds.add(f.sourceSubmissionId);
  const matchedQuotes = storyQuotes.filter((q) => (text && (containment(q.text, text) >= 0.8 || containment(text, q.text) >= 0.8)) || (block?.type === "pullquote" && q.text === block.text));
  for (const q of matchedQuotes) if (q.sourceSubmissionId) submissionIds.add(q.sourceSubmissionId);

  const subRows = submissionIds.size
    ? await db.query.submissions.findMany({ where: inArray(submissions.id, [...submissionIds]), with: { contributor: { columns: { firstName: true, lastName: true } } } })
    : [];
  const subs = subRows.map((s) => {
    const source = s.normalizedText ?? s.description;
    const excerpt = text ? findExcerpt(source, text) : null;
    return { id: s.id, title: s.title, contributorName: s.contributor ? `${s.contributor.firstName} ${s.contributor.lastName}` : null, storyType: s.storyType, excerpt };
  });
  const note = !block ? "This block no longer exists in the article." : !matchedFacts.length && !matchedQuotes.length ? "No recorded fact or quote supports this block: it may have been written by an editor or needs a source." : provenance?.note ?? null;
  return { block, facts: matchedFacts, submissions: subs, quotes: matchedQuotes, note };
}

/** The source sentence that best matches the block text, if any. */
function findExcerpt(source: string, text: string): string | null {
  let best: { s: string; score: number } | null = null;
  for (const s of source.split(/(?<=[.!?])\s+|\n+/)) {
    const score = Math.max(sentenceOverlap(s, text), containment(s, text));
    if (!best || score > best.score) best = { s, score };
  }
  return best && best.score >= 0.3 ? best.s.trim() : null;
}
