import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError } from "@/lib/action-result";
import { createLogger } from "@/server/logger";

const log = createLogger("editorial:topics");

/**
 * The step between what arrived and what gets written.
 *
 * Briefly has always had this stage — submissions are clustered into stories and an editor picks
 * the ones worth running — but it was spread across an inbox, a clusters view and a stories board,
 * in a newsroom's vocabulary. The person doing it is answering one question about each thing on
 * the list: are we running this? So this is that question, on one screen, in those words, and
 * nothing is written until they say so.
 *
 * The statuses underneath are unchanged. A topic kept is a story SELECTED; a topic left is a story
 * REJECTED; the rest are CANDIDATEs nobody has decided about yet. Keeping the vocabulary thin on
 * top of the existing model means the flatplan, the analytics and the pipeline all keep working.
 */

export type Topic = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  storyType: string;
  sectionId: string | null;
  sectionName: string | null;
  /** How many contributions this topic was built from, and who sent them. */
  sources: number;
  contributors: string[];
  /** Whether it has been drafted yet, so "Build draft" knows what is left to do. */
  hasDraft: boolean;
  wordCount: number;
  pictures: number;
  createdAt: Date;
};

export type TopicsBoard = {
  editionId: string;
  topics: Topic[];
  sections: { id: string; name: string }[];
  counts: { waiting: number; kept: number; left: number; drafted: number };
};

const KEPT = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"] as const;
const LEFT = ["REJECTED", "DROPPED"] as const;

/** Everything that came in, as topics to decide about. */
export async function topicsBoard(editionId: string): Promise<TopicsBoard> {
  const rows = await db.query.stories.findMany({
    where: eq(s.stories.editionId, editionId),
    with: {
      section: { columns: { id: true, name: true } },
      article: { columns: { status: true, wordCount: true } },
      media: { columns: { mediaAssetId: true } },
    },
    orderBy: [asc(s.stories.createdAt)],
  });

  /*
   * Who a topic came from.
   *
   * A story points at the cluster the AI grouped, and the cluster holds the contributions. Naming
   * the people on the card is the difference between deciding about a topic and deciding about a
   * topic somebody you know took the trouble to send in.
   */
  const clusterIds = rows.map((row) => row.clusterId).filter((id): id is string => Boolean(id));
  const members = clusterIds.length
    ? await db
        .select({
          clusterId: s.storyClusterMembers.clusterId,
          submissionId: s.storyClusterMembers.submissionId,
          firstName: s.contributors.firstName,
          lastName: s.contributors.lastName,
          contactName: s.submissions.contactName,
        })
        .from(s.storyClusterMembers)
        .innerJoin(s.submissions, eq(s.submissions.id, s.storyClusterMembers.submissionId))
        .leftJoin(s.contributors, eq(s.contributors.id, s.submissions.contributorId))
        .where(inArray(s.storyClusterMembers.clusterId, clusterIds))
    : [];
  const byCluster = new Map<string, { submissions: Set<string>; people: Set<string> }>();
  for (const row of members) {
    const entry = byCluster.get(row.clusterId) ?? { submissions: new Set<string>(), people: new Set<string>() };
    entry.submissions.add(row.submissionId);
    const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || row.contactName;
    if (name) entry.people.add(name);
    byCluster.set(row.clusterId, entry);
  }

  const topics: Topic[] = rows.map((row) => {
    const from = row.clusterId ? byCluster.get(row.clusterId) : undefined;
    return {
      id: row.id,
      title: row.title,
      summary: row.summary ?? null,
      status: row.status as string,
      storyType: row.storyType as string,
      sectionId: row.section?.id ?? null,
      sectionName: row.section?.name ?? null,
      sources: from?.submissions.size ?? 0,
      contributors: [...(from?.people ?? [])],
      hasDraft: Boolean(row.article && row.article.status !== "EMPTY"),
      wordCount: row.article?.wordCount ?? 0,
      pictures: row.media.length,
      createdAt: row.createdAt,
    };
  });

  const sections = await db
    .select({ id: s.editionSections.id, name: s.editionSections.name })
    .from(s.editionSections)
    .where(eq(s.editionSections.editionId, editionId))
    .orderBy(asc(s.editionSections.sortOrder));

  return {
    editionId,
    topics,
    sections,
    counts: {
      waiting: topics.filter((topic) => topic.status === "CANDIDATE").length,
      kept: topics.filter((topic) => (KEPT as readonly string[]).includes(topic.status)).length,
      left: topics.filter((topic) => (LEFT as readonly string[]).includes(topic.status)).length,
      drafted: topics.filter((topic) => topic.hasDraft).length,
    },
  };
}

/**
 * Two topics that turn out to be the same story, made one.
 *
 * The sources move rather than being copied, so nothing is counted twice in the funnel, and the
 * topic left behind is marked as merged rather than deleted — an editor who wants to know where a
 * contribution went should be able to find out.
 */
export async function mergeTopics(editionId: string, keepId: string, mergeIds: string[], userId: string) {
  const ids = mergeIds.filter((id) => id !== keepId);
  if (!ids.length) return { merged: 0 };
  const keep = await db.query.stories.findFirst({ where: and(eq(s.stories.id, keepId), eq(s.stories.editionId, editionId)) });
  if (!keep) throw new NotFoundError("Topic");
  const others = await db.select({ id: s.stories.id }).from(s.stories).where(and(inArray(s.stories.id, ids), eq(s.stories.editionId, editionId)));
  if (!others.length) return { merged: 0 };

  const otherIds = others.map((row) => row.id);
  const otherRows = await db.select({ id: s.stories.id, clusterId: s.stories.clusterId }).from(s.stories).where(inArray(s.stories.id, otherIds));
  await db.transaction(async (tx) => {
    // The contributions move into the kept topic's cluster, so nothing is counted twice in the
    // funnel and nothing is orphaned: every submission still belongs to exactly one topic.
    if (keep.clusterId) {
      const fromClusters = otherRows.map((row) => row.clusterId).filter((id): id is string => Boolean(id));
      if (fromClusters.length) {
        const links = await tx.select().from(s.storyClusterMembers).where(inArray(s.storyClusterMembers.clusterId, fromClusters));
        for (const link of links) {
          await tx
            .insert(s.storyClusterMembers)
            .values({ clusterId: keep.clusterId, submissionId: link.submissionId, similarity: link.similarity, isPrimary: false, addedByAi: false })
            .onConflictDoNothing();
        }
        await tx.delete(s.storyClusterMembers).where(inArray(s.storyClusterMembers.clusterId, fromClusters));
      }
    }

    const pictures = await tx.select().from(s.storyMedia).where(inArray(s.storyMedia.storyId, otherIds));
    for (const picture of pictures) {
      await tx.insert(s.storyMedia).values({ storyId: keepId, mediaAssetId: picture.mediaAssetId, role: picture.role, sortOrder: picture.sortOrder }).onConflictDoNothing();
    }
    await tx.delete(s.storyMedia).where(inArray(s.storyMedia.storyId, otherIds));

    await tx.update(s.stories).set({ status: "DROPPED", editorialNotes: `Merged into "${keep.title}"` }).where(inArray(s.stories.id, otherIds));
  });

  await audit({ action: "topic.merge", userId, entityType: "STORY", entityId: keepId, editionId, metadata: { merged: otherIds } });
  log.info("topics merged", { editionId, keepId, merged: otherIds.length });
  return { merged: otherIds.length };
}

/**
 * Build the draft: every topic that was kept and has nothing written yet.
 *
 * The one button at the end of this step, and the moment the issue stops being a list of decisions
 * and becomes something to read. Queued rather than awaited — writing a dozen articles takes
 * minutes, and holding a click open for minutes is how people conclude a thing is broken.
 */
export async function buildDraft(editionId: string, userId: string): Promise<{ queued: number; alreadyWritten: number }> {
  const rows = await db.query.stories.findMany({
    where: and(eq(s.stories.editionId, editionId), inArray(s.stories.status, ["SELECTED", "DRAFTING"])),
    with: { article: { columns: { status: true } } },
  });
  const needing = rows.filter((row) => !row.article || row.article.status === "EMPTY");

  const { enqueueJob } = await import("@/server/jobs/queue");
  const { JOB_TYPES } = await import("@/server/jobs/registry");
  const { kickJobRunner } = await import("@/server/jobs/runner");
  for (const story of needing) {
    await enqueueJob({
      type: JOB_TYPES.STORY_DRAFT,
      payload: { storyId: story.id, userId },
      idempotencyKey: `story.draft:${story.id}:${Date.now()}`,
      editionId,
      createdById: userId,
      maxAttempts: 2,
    });
  }
  if (needing.length) kickJobRunner();
  await audit({ action: "edition.build_draft", userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { queued: needing.length } });
  log.info("build draft", { editionId, queued: needing.length });
  return { queued: needing.length, alreadyWritten: rows.length - needing.length };
}

/** Topics nobody has decided about, for the step's "you still have N to look at". */
export async function undecidedCount(editionId: string): Promise<number> {
  const rows = await db
    .select({ id: s.stories.id })
    .from(s.stories)
    .where(and(eq(s.stories.editionId, editionId), eq(s.stories.status, "CANDIDATE"), ne(s.stories.title, "")));
  return rows.length;
}
