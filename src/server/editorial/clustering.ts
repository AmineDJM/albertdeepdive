import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { editionSections, mediaAssets, quotes, storyClusterMembers, storyClusters, submissions, type FactSheetEntry, type MissingInformationItem, type WarningItem } from "@/server/db/schema";
import { audit, recordDecision } from "@/server/audit";
import { createLogger } from "@/server/logger";
import type { JobContext } from "@/server/jobs/registry";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { defaultSectionForStoryType } from "@/lib/constants";
import { clusterSubmissions, eventDateKey, type ClusterInput } from "@/lib/editorial/clustering";
import { buildFactSheet, detectMissingInformation, nameCluster, scoreRelevance, scoreTotal, type AiServiceContext, type FactSheetSubmission } from "@/server/ai/services";

const log = createLogger("editorial:clustering");

/** The cluster fact sheet keeps the category alongside the canonical FactSheetEntry fields. */
export type ExtendedFactSheetEntry = FactSheetEntry & { category?: string };

export type ClusterEditionResult = {
  editionId: string;
  considered: number;
  groups: number;
  created: string[];
  updated: string[];
  dismissed: string[];
  attachedDuplicates: number;
};

type SubmissionRow = typeof submissions.$inferSelect & {
  campuses: { campusId: string }[];
  contributor: { firstName: string; lastName: string } | null;
};

const ACTIVE_STATUSES = ["NEW", "NEEDS_REVIEW", "MISSING_INFO", "DUPLICATE", "POTENTIAL_STORY", "ACCEPTED"] as const;

function contributorName(sub: { contributor: { firstName: string; lastName: string } | null; contactName: string | null }): string | null {
  return sub.contributor ? `${sub.contributor.firstName} ${sub.contributor.lastName}` : sub.contactName;
}

function submissionText(sub: typeof submissions.$inferSelect): string {
  return sub.normalizedText ?? [sub.description, sub.peopleInvolved ? `People involved: ${sub.peopleInvolved}` : "", sub.organisationsInvolved ? `Organisations: ${sub.organisationsInvolved}` : ""].filter(Boolean).join("\n");
}

function toClusterInput(sub: SubmissionRow): ClusterInput {
  return {
    id: sub.id,
    title: sub.title,
    text: submissionText(sub),
    storyType: sub.storyType,
    campusIds: sub.campuses.map((c) => c.campusId),
    people: sub.aiEntities?.people?.map((p) => p.name) ?? [],
    organisations: sub.aiEntities?.organisations?.map((o) => o.name) ?? [],
    eventDate: eventDateKey({ iso: sub.eventDate ? sub.eventDate.toISOString() : null, text: sub.eventDateText ?? sub.aiEntities?.dates?.[0]?.text ?? null }),
  };
}

function isFirstPersonText(text: string): boolean {
  const head = text.slice(0, 200);
  return /(^|[\s,])(I|I['’]m|I['’]ve|we|we['’]re|our|my)([\s,.!?]|$)/i.test(head);
}

/**
 * Groups an edition's unclustered submissions into story clusters, enriches every touched cluster
 * (name, fact sheet, scores, missing information, warnings) and keeps re-runs idempotent by
 * reusing PROPOSED clusters whose members overlap and dismissing the ones left empty.
 */
export async function clusterEdition(editionId: string, options: { jobCtx?: Pick<JobContext, "progress" | "log"> | null; threshold?: number; jobId?: string | null } = {}): Promise<ClusterEditionResult> {
  const allSubs = (await db.query.submissions.findMany({
    where: and(eq(submissions.editionId, editionId), inArray(submissions.status, [...ACTIVE_STATUSES])),
    with: { campuses: true, contributor: { columns: { firstName: true, lastName: true } } },
    orderBy: [asc(submissions.createdAt)],
  })) as SubmissionRow[];
  const clusters = await db.query.storyClusters.findMany({ where: eq(storyClusters.editionId, editionId), with: { members: true } });
  const locked = new Set<string>();
  const clusterOfSubmission = new Map<string, string>();
  for (const c of clusters) {
    for (const m of c.members) {
      clusterOfSubmission.set(m.submissionId, c.id);
      if (c.status === "CONFIRMED" || c.status === "MERGED") locked.add(m.submissionId);
    }
  }

  const result: ClusterEditionResult = { editionId, considered: 0, groups: 0, created: [], updated: [], dismissed: [], attachedDuplicates: 0 };
  const touched = new Set<string>();

  // Duplicates of a submission that already sits in a confirmed cluster join that cluster.
  const free: SubmissionRow[] = [];
  for (const sub of allSubs) {
    if (locked.has(sub.id)) continue;
    const originalCluster = sub.duplicateOfId ? clusterOfSubmission.get(sub.duplicateOfId) : undefined;
    if (originalCluster && locked.has(sub.duplicateOfId!)) {
      await db.insert(storyClusterMembers).values({ clusterId: originalCluster, submissionId: sub.id, similarity: 1, isPrimary: false, addedByAi: true }).onConflictDoNothing();
      await db.update(submissions).set({ suggestedClusterId: originalCluster }).where(eq(submissions.id, sub.id));
      touched.add(originalCluster);
      result.attachedDuplicates += 1;
      continue;
    }
    free.push(sub);
  }
  result.considered = free.length;

  const groups = free.length ? clusterSubmissions(free.map(toClusterInput), { threshold: options.threshold }) : [];
  result.groups = groups.length;
  const proposed = clusters.filter((c) => c.status === "PROPOSED");
  const claimed = new Set<string>();

  for (const [index, group] of groups.entries()) {
    const memberIds = new Set(group.ids);
    // Reuse the PROPOSED cluster with the largest overlap (Jaccard ≥ 0.5 or containment).
    let best: { id: string; score: number } | null = null;
    for (const c of proposed) {
      if (claimed.has(c.id)) continue;
      const existing = new Set(c.members.map((m) => m.submissionId));
      let inter = 0;
      for (const id of existing) if (memberIds.has(id)) inter += 1;
      if (!inter) continue;
      const union = existing.size + memberIds.size - inter;
      const score = Math.max(inter / union, inter / existing.size, inter / memberIds.size);
      if (score >= 0.5 && (!best || score > best.score)) best = { id: c.id, score };
    }
    let clusterId: string;
    if (best) {
      clusterId = best.id;
      claimed.add(clusterId);
      const existing = proposed.find((c) => c.id === clusterId)!;
      const existingIds = new Set(existing.members.map((m) => m.submissionId));
      const toRemove = existing.members.filter((m) => m.addedByAi && !memberIds.has(m.submissionId)).map((m) => m.submissionId);
      if (toRemove.length) {
        await db.delete(storyClusterMembers).where(and(eq(storyClusterMembers.clusterId, clusterId), inArray(storyClusterMembers.submissionId, toRemove)));
        await db.update(submissions).set({ suggestedClusterId: null }).where(and(inArray(submissions.id, toRemove), eq(submissions.suggestedClusterId, clusterId)));
      }
      const toAdd = group.ids.filter((id) => !existingIds.has(id));
      if (toAdd.length) {
        await db.insert(storyClusterMembers).values(toAdd.map((id) => ({ clusterId, submissionId: id, similarity: group.similarities[id] ?? null, isPrimary: id === group.primaryId && !existing.members.some((m) => m.isPrimary), addedByAi: true }))).onConflictDoNothing();
      }
      result.updated.push(clusterId);
    } else {
      const primary = free.find((s) => s.id === group.primaryId)!;
      const [created] = await db
        .insert(storyClusters)
        .values({ editionId, title: primary.title, status: "PROPOSED", primaryStoryType: primary.storyType, submissionCount: group.ids.length, createdByAi: true })
        .returning({ id: storyClusters.id });
      clusterId = created.id;
      await db.insert(storyClusterMembers).values(group.ids.map((id) => ({ clusterId, submissionId: id, similarity: group.similarities[id] ?? null, isPrimary: id === group.primaryId, addedByAi: true })));
      result.created.push(clusterId);
    }
    await db.update(submissions).set({ suggestedClusterId: clusterId }).where(inArray(submissions.id, group.ids));
    touched.add(clusterId);
    await options.jobCtx?.progress?.(index + 1, groups.length, `Clustering: ${index + 1}/${groups.length} groups`);
  }

  // PROPOSED clusters that lost all their members are dismissed (never deleted: they carry history).
  for (const c of proposed) {
    if (claimed.has(c.id)) continue;
    const remaining = await db.select({ n: sql<number>`count(*)::int` }).from(storyClusterMembers).where(eq(storyClusterMembers.clusterId, c.id));
    const n = Number(remaining[0]?.n ?? 0);
    const stillFree = c.members.some((m) => free.some((s) => s.id === m.submissionId));
    if (n === 0 || (stillFree && c.members.every((m) => m.addedByAi))) {
      await db.delete(storyClusterMembers).where(eq(storyClusterMembers.clusterId, c.id));
      await db.update(storyClusters).set({ status: "DISMISSED", submissionCount: 0 }).where(eq(storyClusters.id, c.id));
      await db.update(submissions).set({ suggestedClusterId: null }).where(eq(submissions.suggestedClusterId, c.id));
      result.dismissed.push(c.id);
    }
  }

  let done = 0;
  for (const clusterId of touched) {
    await enrichCluster(clusterId, { jobId: options.jobId ?? null });
    done += 1;
    await options.jobCtx?.progress?.(done, touched.size, `Enriching clusters: ${done}/${touched.size}`);
  }
  await audit({ action: "edition.cluster", actorType: "AI", entityType: "EDITION", entityId: editionId, editionId, metadata: { considered: result.considered, groups: result.groups, created: result.created.length, updated: result.updated.length, dismissed: result.dismissed.length, attachedDuplicates: result.attachedDuplicates } });
  log.info("edition clustered", { editionId, considered: result.considered, groups: result.groups, created: result.created.length, updated: result.updated.length, dismissed: result.dismissed.length, attachedDuplicates: result.attachedDuplicates });
  return result;
}

async function loadClusterWithSubmissions(clusterId: string) {
  const cluster = await db.query.storyClusters.findFirst({ where: eq(storyClusters.id, clusterId), with: { members: true } });
  if (!cluster) throw new NotFoundError("Cluster");
  const ids = cluster.members.map((m) => m.submissionId);
  const subs = ids.length
    ? ((await db.query.submissions.findMany({ where: inArray(submissions.id, ids), with: { campuses: true, contributor: { columns: { firstName: true, lastName: true } } }, orderBy: [asc(submissions.createdAt)] })) as SubmissionRow[])
    : [];
  const primaryId = cluster.members.find((m) => m.isPrimary)?.submissionId;
  subs.sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId) || a.createdAt.getTime() - b.createdAt.getTime());
  return { cluster, subs };
}

/**
 * Runs the organisation services on a cluster: naming, fact sheet (+ quotes rows), relevance scores,
 * missing information, warnings, suggested section and counts.
 */
export async function enrichCluster(clusterId: string, options: { jobId?: string | null } = {}) {
  const { cluster, subs } = await loadClusterWithSubmissions(clusterId);
  const ctx: AiServiceContext = { editionId: cluster.editionId, entityType: "CLUSTER", entityId: cluster.id, jobId: options.jobId ?? null };
  if (!subs.length) {
    await db.update(storyClusters).set({ submissionCount: 0, mediaCount: 0, quoteCount: 0 }).where(eq(storyClusters.id, clusterId));
    return cluster;
  }
  const serviceSubs: FactSheetSubmission[] = subs.map((s) => ({ id: s.id, title: s.title, text: submissionText(s), storyType: s.storyType, contributor: contributorName(s), quotes: s.quotes }));
  const nameById = new Map(subs.map((s) => [s.id, contributorName(s) ?? s.title]));

  const named = await nameCluster({ submissions: serviceSubs }, ctx);
  const sheet = await buildFactSheet({ submissions: serviceSubs }, ctx);
  const mediaRows = await db.select({ submissionId: mediaAssets.submissionId, kind: mediaAssets.kind }).from(mediaAssets).where(and(inArray(mediaAssets.submissionId, subs.map((s) => s.id)), eq(mediaAssets.isArchived, false)));
  const campusIds = [...new Set(subs.flatMap((s) => s.campuses.map((c) => c.campusId)))];
  const scores = await scoreRelevance(
    { title: named.output.title, storyType: named.output.primaryStoryType, campuses: campusIds, campusScope: campusIds.length === 0 ? "SCHOOL_WIDE" : campusIds.length > 1 ? "MULTI" : "SINGLE", summary: named.output.summary, sourceCount: subs.length, mediaCount: mediaRows.length, quoteCount: sheet.output.quotes.length, wordCount: subs.reduce((n, s) => n + s.wordCount, 0) },
    ctx,
  );
  const extra = subs.reduce<Record<string, unknown>>((acc, s) => ({ ...s.extra, ...acc }), {});
  const missing = await detectMissingInformation(
    {
      storyType: named.output.primaryStoryType,
      title: named.output.title,
      facts: sheet.output.facts.map((f) => ({ statement: f.statement, category: f.category })),
      text: serviceSubs.map((s) => s.text).join("\n"),
      extra,
      mediaCount: mediaRows.length,
      mediaKinds: [...new Set(mediaRows.map((m) => m.kind))],
      quoteCount: sheet.output.quotes.length,
      urls: [...new Set(subs.flatMap((s) => s.urls))],
    },
    ctx,
  );

  const factSheet: ExtendedFactSheetEntry[] = sheet.output.facts.map((f) => ({ statement: f.statement, sourceSubmissionIds: f.sourceSubmissionIds, confidence: f.confidence, excerpt: f.excerpt ?? undefined, category: f.category }));
  const warnings: WarningItem[] = named.output.contradictions.map((c) => ({
    code: /spelling|name/i.test(c.topic) ? "NAME_MISMATCH" : "CONTRADICTION",
    message: `${c.topic}: "${c.statementA}" (${nameById.get(c.submissionIds[0] ?? "") ?? "source 1"}) vs "${c.statementB}" (${nameById.get(c.submissionIds[1] ?? "") ?? "source 2"}). Confirm before publication.`,
    severity: "warning",
  }));
  for (const f of sheet.output.facts) {
    if (f.confidence === "CONFLICTING" && !warnings.some((w) => w.message.includes(f.statement))) warnings.push({ code: "FACTUAL_CONFLICT", message: f.statement, severity: "warning" });
  }
  const sectionRows = await db.query.editionSections.findMany({ where: eq(editionSections.editionId, cluster.editionId) });
  const visible = sectionRows.filter((s) => !s.isHidden).map((s) => s.slug);
  const preferred = defaultSectionForStoryType(named.output.primaryStoryType);
  const suggestedSectionSlug = visible.length === 0 || visible.includes(preferred) ? preferred : (subs.map((s) => s.suggestedSectionSlug).find((slug) => slug && visible.includes(slug)) ?? null);
  const aiScores = { ...Object.fromEntries(Object.entries(scores.output).filter(([k]) => k !== "rationale")) } as Record<string, number>;
  const total = scoreTotal(aiScores);

  // Quotes live in the quotes table keyed by cluster until a story exists.
  await db.delete(quotes).where(and(eq(quotes.clusterId, clusterId), isNull(quotes.storyId), eq(quotes.createdByAi, true)));
  if (sheet.output.quotes.length) {
    await db.insert(quotes).values(
      sheet.output.quotes.map((q) => {
        const source = subs.find((s) => s.id === q.sourceSubmissionId);
        const firstPerson = source && !q.speakerName && isFirstPersonText(source.description) && source.description.includes(q.text.slice(0, 40));
        return {
          editionId: cluster.editionId,
          clusterId,
          storyId: null,
          text: q.text,
          speakerName: q.speakerName ?? (firstPerson ? contributorName(source) : null),
          speakerRole: q.speakerRole ?? (firstPerson ? "contributor" : null),
          sourceSubmissionId: q.sourceSubmissionId,
          isPullQuoteCandidate: !!q.speakerName && q.text.length <= 140,
          aiScore: q.speakerName ? 0.8 : 0.5,
          createdByAi: true,
        };
      }),
    );
  }

  const [updated] = await db
    .update(storyClusters)
    .set({
      title: named.output.title,
      summary: named.output.summary,
      primaryStoryType: named.output.primaryStoryType,
      suggestedSectionSlug,
      submissionCount: subs.length,
      mediaCount: mediaRows.length,
      quoteCount: sheet.output.quotes.length,
      factSheet: factSheet as FactSheetEntry[],
      aiScores: { ...aiScores, total },
      aiScoreTotal: total,
      missingInformation: missing.output.items as MissingInformationItem[],
      warnings,
    })
    .where(eq(storyClusters.id, clusterId))
    .returning();
  return updated;
}

async function recount(clusterId: string) {
  const members = await db.select({ submissionId: storyClusterMembers.submissionId }).from(storyClusterMembers).where(eq(storyClusterMembers.clusterId, clusterId));
  const ids = members.map((m) => m.submissionId);
  const [media] = ids.length ? await db.select({ n: sql<number>`count(*)::int` }).from(mediaAssets).where(and(inArray(mediaAssets.submissionId, ids), eq(mediaAssets.isArchived, false))) : [{ n: 0 }];
  await db.update(storyClusters).set({ submissionCount: ids.length, mediaCount: Number(media?.n ?? 0) }).where(eq(storyClusters.id, clusterId));
  return ids;
}

/** Merges clusters into one (the first id, or the one that already has a story). */
export async function mergeClusters(clusterIds: string[], userId: string, options: { targetId?: string; reason?: string | null } = {}) {
  const ids = [...new Set(clusterIds)];
  if (ids.length < 2) throw new ValidationError("Select at least two clusters to merge");
  const rows = await db.query.storyClusters.findMany({ where: inArray(storyClusters.id, ids), with: { story: true } });
  if (rows.length !== ids.length) throw new NotFoundError("Cluster");
  if (new Set(rows.map((r) => r.editionId)).size > 1) throw new ValidationError("Clusters belong to different editions");
  const withStory = rows.filter((r) => r.story);
  if (withStory.length > 1 && !options.targetId) throw new ValidationError("Several clusters already have a story: choose the target explicitly");
  const targetId = options.targetId ?? withStory[0]?.id ?? ids[0];
  if (!ids.includes(targetId)) throw new ValidationError("The target must be one of the merged clusters");
  const others = ids.filter((id) => id !== targetId);
  const editionId = rows[0].editionId;
  await db.transaction(async (tx) => {
    const members = await tx.select().from(storyClusterMembers).where(inArray(storyClusterMembers.clusterId, others));
    if (members.length) {
      await tx.insert(storyClusterMembers).values(members.map((m) => ({ clusterId: targetId, submissionId: m.submissionId, similarity: m.similarity, isPrimary: false, addedByAi: false }))).onConflictDoNothing();
      await tx.delete(storyClusterMembers).where(inArray(storyClusterMembers.clusterId, others));
      await tx.update(submissions).set({ suggestedClusterId: targetId }).where(inArray(submissions.id, members.map((m) => m.submissionId)));
    }
    await tx.update(storyClusters).set({ status: "MERGED", mergedIntoId: targetId, submissionCount: 0 }).where(inArray(storyClusters.id, others));
    await tx.update(quotes).set({ clusterId: targetId }).where(and(inArray(quotes.clusterId, others), isNull(quotes.storyId)));
  });
  await recount(targetId);
  await enrichCluster(targetId);
  await recordDecision({ editionId, entityType: "CLUSTER", entityId: targetId, decision: "CLUSTER_MERGE", reason: options.reason ?? null, previousValue: { clusters: ids }, newValue: { target: targetId, merged: others }, userId });
  return db.query.storyClusters.findFirst({ where: eq(storyClusters.id, targetId), with: { members: true } });
}

/** Moves some submissions of a cluster into a new cluster. */
export async function splitCluster(clusterId: string, submissionIds: string[], userId: string, options: { title?: string; reason?: string | null } = {}) {
  const ids = [...new Set(submissionIds)];
  if (!ids.length) throw new ValidationError("Select the submissions to split off");
  const { cluster, subs } = await loadClusterWithSubmissions(clusterId);
  const moving = subs.filter((s) => ids.includes(s.id));
  if (moving.length !== ids.length) throw new ValidationError("Some submissions are not members of this cluster");
  if (moving.length === subs.length) throw new ValidationError("Cannot move every submission out of the cluster");
  const primary = moving[0];
  const [created] = await db
    .insert(storyClusters)
    .values({ editionId: cluster.editionId, title: options.title ?? primary.title, status: "PROPOSED", primaryStoryType: primary.storyType, submissionCount: moving.length, createdByAi: false })
    .returning();
  await db.transaction(async (tx) => {
    await tx.delete(storyClusterMembers).where(and(eq(storyClusterMembers.clusterId, clusterId), inArray(storyClusterMembers.submissionId, ids)));
    await tx.insert(storyClusterMembers).values(moving.map((s, i) => ({ clusterId: created.id, submissionId: s.id, similarity: null, isPrimary: i === 0, addedByAi: false })));
    await tx.update(submissions).set({ suggestedClusterId: created.id }).where(inArray(submissions.id, ids));
    await tx.update(quotes).set({ clusterId: created.id }).where(and(eq(quotes.clusterId, clusterId), isNull(quotes.storyId), inArray(quotes.sourceSubmissionId, ids)));
  });
  const remainingPrimary = await db.select({ n: sql<number>`count(*)::int` }).from(storyClusterMembers).where(and(eq(storyClusterMembers.clusterId, clusterId), eq(storyClusterMembers.isPrimary, true)));
  if (Number(remainingPrimary[0]?.n ?? 0) === 0) {
    const first = await db.select({ submissionId: storyClusterMembers.submissionId }).from(storyClusterMembers).where(eq(storyClusterMembers.clusterId, clusterId)).limit(1);
    if (first[0]) await db.update(storyClusterMembers).set({ isPrimary: true }).where(and(eq(storyClusterMembers.clusterId, clusterId), eq(storyClusterMembers.submissionId, first[0].submissionId)));
  }
  await recount(clusterId);
  await enrichCluster(clusterId);
  await enrichCluster(created.id);
  await recordDecision({ editionId: cluster.editionId, entityType: "CLUSTER", entityId: clusterId, decision: "CLUSTER_SPLIT", reason: options.reason ?? null, previousValue: { members: subs.map((s) => s.id) }, newValue: { newCluster: created.id, moved: ids }, userId });
  return db.query.storyClusters.findFirst({ where: eq(storyClusters.id, created.id), with: { members: true } });
}

export async function confirmCluster(clusterId: string, userId: string) {
  const cluster = await db.query.storyClusters.findFirst({ where: eq(storyClusters.id, clusterId) });
  if (!cluster) throw new NotFoundError("Cluster");
  if (cluster.status === "MERGED") throw new ValidationError("A merged cluster cannot be confirmed");
  const [row] = await db.update(storyClusters).set({ status: "CONFIRMED" }).where(eq(storyClusters.id, clusterId)).returning();
  await recordDecision({ editionId: cluster.editionId, entityType: "CLUSTER", entityId: clusterId, decision: "CLUSTER_CONFIRM", previousValue: { status: cluster.status }, newValue: { status: "CONFIRMED" }, userId });
  return row;
}

export async function dismissCluster(clusterId: string, userId: string, reason?: string | null) {
  const cluster = await db.query.storyClusters.findFirst({ where: eq(storyClusters.id, clusterId), with: { story: true } });
  if (!cluster) throw new NotFoundError("Cluster");
  if (cluster.story && !["REJECTED", "DROPPED"].includes(cluster.story.status)) throw new ValidationError("This cluster has an active story: drop or reject the story first");
  const [row] = await db.update(storyClusters).set({ status: "DISMISSED" }).where(eq(storyClusters.id, clusterId)).returning();
  await db.update(submissions).set({ suggestedClusterId: null }).where(eq(submissions.suggestedClusterId, clusterId));
  await recordDecision({ editionId: cluster.editionId, entityType: "CLUSTER", entityId: clusterId, decision: "CLUSTER_DISMISS", reason: reason ?? null, previousValue: { status: cluster.status }, newValue: { status: "DISMISSED" }, userId });
  return row;
}

/** Moves one submission to another cluster of the same edition (re-enriching both). */
export async function moveSubmission(submissionId: string, toClusterId: string, userId: string) {
  const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!sub) throw new NotFoundError("Submission");
  const target = await db.query.storyClusters.findFirst({ where: eq(storyClusters.id, toClusterId) });
  if (!target) throw new NotFoundError("Cluster");
  if (target.editionId !== sub.editionId) throw new ValidationError("The cluster belongs to another edition");
  if (target.status === "MERGED" || target.status === "DISMISSED") throw new ValidationError(`Cannot move a submission into a ${target.status.toLowerCase()} cluster`);
  const memberships = await db.select().from(storyClusterMembers).where(eq(storyClusterMembers.submissionId, submissionId));
  const fromIds = memberships.map((m) => m.clusterId).filter((id) => id !== toClusterId);
  await db.transaction(async (tx) => {
    if (fromIds.length) await tx.delete(storyClusterMembers).where(and(eq(storyClusterMembers.submissionId, submissionId), inArray(storyClusterMembers.clusterId, fromIds)));
    await tx.insert(storyClusterMembers).values({ clusterId: toClusterId, submissionId, similarity: null, isPrimary: false, addedByAi: false }).onConflictDoNothing();
    await tx.update(submissions).set({ suggestedClusterId: toClusterId }).where(eq(submissions.id, submissionId));
    await tx.update(quotes).set({ clusterId: toClusterId }).where(and(eq(quotes.sourceSubmissionId, submissionId), isNull(quotes.storyId)));
  });
  for (const id of fromIds) {
    const remaining = await recount(id);
    if (remaining.length) await enrichCluster(id);
    else await db.update(storyClusters).set({ status: "DISMISSED" }).where(and(eq(storyClusters.id, id), eq(storyClusters.status, "PROPOSED")));
  }
  await recount(toClusterId);
  await enrichCluster(toClusterId);
  await recordDecision({ editionId: sub.editionId, entityType: "SUBMISSION", entityId: submissionId, decision: "SUBMISSION_MOVE_CLUSTER", previousValue: { clusters: fromIds }, newValue: { cluster: toClusterId }, userId });
  return db.query.storyClusters.findFirst({ where: eq(storyClusters.id, toClusterId), with: { members: true } });
}

/** Clusters of an edition with their members and the attached story (if any). */
export async function listClusters(editionId: string, options: { statuses?: (typeof storyClusters.$inferSelect)["status"][] } = {}) {
  return db.query.storyClusters.findMany({
    where: options.statuses?.length ? and(eq(storyClusters.editionId, editionId), inArray(storyClusters.status, options.statuses)) : eq(storyClusters.editionId, editionId),
    with: { members: { with: { submission: { columns: { id: true, title: true, storyType: true, status: true, contributorId: true, wordCount: true } } } }, story: { columns: { id: true, title: true, status: true, slug: true } } },
    orderBy: [sql`${storyClusters.aiScoreTotal} desc nulls last`, asc(storyClusters.createdAt)],
  });
}
