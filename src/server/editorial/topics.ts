import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { createInformationRequest } from "./information-requests";
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
  /**
   * The newsroom has asked whoever raised this for more and is waiting.
   *
   * A state, not a decision: the topic stays exactly where it is on the board and the badge is
   * there so nobody asks the same person the same thing again on Thursday. It clears itself when
   * the answer arrives.
   */
  moreRequested: boolean;
  /** When that question went out, when one is outstanding. */
  moreAskedAt: Date | null;
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

  /*
   * Which topics are waiting on an answer.
   *
   * Read from the information requests themselves rather than from a flag on the story, so the
   * state cannot drift from the thing it describes: the moment the contributor answers, the
   * request becomes ANSWERED and the topic is simply ready to decide again. Nothing has to
   * remember to clear anything.
   */
  const open = rows.length
    ? await db
        .select({ storyId: s.informationRequests.storyId, sentAt: s.informationRequests.sentAt, createdAt: s.informationRequests.createdAt })
        .from(s.informationRequests)
        .where(and(eq(s.informationRequests.editionId, editionId), inArray(s.informationRequests.status, ["PENDING", "SENT"])))
    : [];
  const waitingOn = new Map<string, Date>();
  for (const request of open) {
    if (!request.storyId) continue;
    const at = request.sentAt ?? request.createdAt;
    const known = waitingOn.get(request.storyId);
    if (!known || at > known) waitingOn.set(request.storyId, at);
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
      moreRequested: waitingOn.has(row.id),
      moreAskedAt: waitingOn.get(row.id) ?? null,
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

/** What happened when the newsroom asked for more. */
export type AskedForMore = {
  /** The contributor the question went to, when it went to somebody. */
  contributor: { id: string; name: string } | null;
  /** True when the request was already outstanding and a second one was not sent. */
  alreadyWaiting: boolean;
};

/**
 * Ask the contributor behind a topic for a little more, in the editor's own words.
 *
 * The third answer an editor can give a topic, beside keeping it and leaving it out, and the one
 * that was missing: a topic can be the right story told in two sentences with no names and no
 * date, and the honest response is neither yes nor no but "tell me more".
 *
 * It decides nothing. The topic stays on the undecided pile with a quiet note that an answer is
 * outstanding, and that note clears itself the moment the answer lands — because it is read from
 * the request's own status rather than copied onto the story, so there is no second place for the
 * truth to live.
 *
 * Underneath it is the information-request machinery the newsroom already had, which matters for
 * one specific reason: a contributor answering through their personal link produces a follow-up
 * submission that is attached to *this topic's existing cluster*. No second topic is created and
 * no contribution is duplicated — the topic simply gains a source and gets better.
 */
export async function askForMore(editionId: string, storyId: string, message: string, userId: string): Promise<AskedForMore> {
  const asked = message.trim();
  if (!asked) throw new ValidationError("Say what you would like to know", { message: ["Write your question."] });

  const story = await db.query.stories.findFirst({
    where: and(eq(s.stories.id, storyId), eq(s.stories.editionId, editionId)),
    with: { cluster: { with: { members: true } } },
  });
  if (!story) throw new NotFoundError("Topic");

  // Asking twice while the first is still out is not a second question, it is a duplicate email.
  const outstanding = await db.query.informationRequests.findFirst({
    where: and(eq(s.informationRequests.storyId, storyId), inArray(s.informationRequests.status, ["PENDING", "SENT"])),
  });
  if (outstanding) return { contributor: null, alreadyWaiting: true };

  /*
   * Who to write to.
   *
   * The primary contribution's author — the same person `suggestInformationRequest` picks for this
   * operation everywhere else in the product. A topic can come from three people, and mailing all
   * three from one click is a surprise; the board already names the others, and the editor can ask
   * again once this answer is in.
   */
  const members = story.cluster?.members ?? [];
  const primaryId = members.find((member) => member.isPrimary)?.submissionId ?? members[0]?.submissionId ?? null;
  const primary = primaryId
    ? await db.query.submissions.findFirst({
        where: eq(s.submissions.id, primaryId),
        with: { contributor: { columns: { id: true, firstName: true, lastName: true } } },
      })
    : null;
  const contributor = primary?.contributor ?? null;
  if (!contributor) return { contributor: null, alreadyWaiting: false };

  await createInformationRequest({
    storyId,
    submissionId: primary?.id ?? null,
    contributorId: contributor.id,
    // One free-text question rather than a checklist: the editor wrote a sentence, the contributor
    // answers it in a box. The covering message and the question are the same words on purpose.
    items: [{ key: "more", label: asked }],
    message: asked,
    userId,
  });

  log.info("asked for more on a topic", { editionId, storyId, contributorId: contributor.id });
  return { contributor: { id: contributor.id, name: [contributor.firstName, contributor.lastName].filter(Boolean).join(" ") }, alreadyWaiting: false };
}
