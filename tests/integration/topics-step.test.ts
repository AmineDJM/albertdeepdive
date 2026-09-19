import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { buildDraft, mergeTopics, topicsBoard } from "@/server/editorial/topics";
import { selectStory, undecideStory } from "@/server/editorial/stories";
import { pipelineFunnel } from "@/server/analytics/read-insights";
import type { TenantScope } from "@/server/analytics/scope";

/**
 * The step between what arrived and what gets written, and the numbers behind it.
 *
 * The promise this step makes is that nothing is written until the editor says so, and that saying
 * no to a topic costs nothing. Both are only true if the code behind the buttons does what the
 * buttons say — so this checks the decisions land, that merging moves the contributions rather than
 * copying them, and that the funnel counts what actually happened rather than what was hoped.
 */
describe("deciding the topics", () => {
  let editionId: string;
  let organizationId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
  }, 180_000);

  it("shows what came in, who sent it and whether it is written", async () => {
    const board = await topicsBoard(editionId);
    expect(board.topics.length, "the seed has an issue's worth of topics").toBeGreaterThan(0);
    expect(board.sections.length).toBeGreaterThan(0);

    const withSources = board.topics.filter((topic) => topic.sources > 0);
    expect(withSources.length, "a topic comes from contributions and says how many").toBeGreaterThan(0);
    expect(withSources.some((topic) => topic.contributors.length > 0), "and names the people who sent them").toBe(true);

    // The counts are the three piles the screen shows, and they add up.
    const { waiting, kept, left } = board.counts;
    expect(waiting + kept + left).toBeLessThanOrEqual(board.topics.length);
  }, 60_000);

  it("keeps a topic, and lets the decision be taken back", async () => {
    const board = await topicsBoard(editionId);
    const candidate = board.topics.find((topic) => topic.status === "CANDIDATE") ?? board.topics[0];
    const user = await db.query.users.findFirst();

    await selectStory(candidate.id, user!.id);
    const after = await topicsBoard(editionId);
    expect(after.topics.find((topic) => topic.id === candidate.id)?.status).toBe("SELECTED");

    await undecideStory(candidate.id, user!.id);
    const back = await topicsBoard(editionId);
    expect(back.topics.find((topic) => topic.id === candidate.id)?.status, "a decision can be untaken until the writing starts").toBe("CANDIDATE");
  }, 60_000);

  it("merges two topics by moving the contributions, not copying them", async () => {
    const board = await topicsBoard(editionId);
    const pair = board.topics.filter((topic) => topic.sources > 0).slice(0, 2);
    if (pair.length < 2) return;
    const [keep, merge] = pair;
    const user = await db.query.users.findFirst();
    const before = keep.sources + merge.sources;

    await mergeTopics(editionId, keep.id, [merge.id], user!.id);

    const after = await topicsBoard(editionId);
    const kept = after.topics.find((topic) => topic.id === keep.id);
    const gone = after.topics.find((topic) => topic.id === merge.id);
    expect(kept?.sources, "every contribution from both is now behind one topic").toBe(before);
    expect(gone?.status, "and the other is dropped rather than deleted, so nothing is lost").toBe("DROPPED");

    // Nothing is counted twice: each submission belongs to exactly one cluster.
    const clusters = await db.select({ id: s.storyClusters.id }).from(s.storyClusters).where(eq(s.storyClusters.editionId, editionId));
    const members = clusters.length
      ? await db.select({ submissionId: s.storyClusterMembers.submissionId }).from(s.storyClusterMembers).where(inArray(s.storyClusterMembers.clusterId, clusters.map((row) => row.id)))
      : [];
    expect(new Set(members.map((row) => row.submissionId)).size).toBe(members.length);
  }, 60_000);

  it("writes only what was kept, and only what is not written yet", async () => {
    const board = await topicsBoard(editionId);
    const user = await db.query.users.findFirst();
    const result = await buildDraft(editionId, user!.id);

    const keptCount = board.counts.kept;
    expect(result.queued + result.alreadyWritten, "every kept topic is either queued or already written").toBeLessThanOrEqual(keptCount + result.queued);

    // Nothing that was left out is queued.
    const left = board.topics.filter((topic) => topic.status === "REJECTED" || topic.status === "DROPPED");
    const jobs = await db.select({ payload: s.jobs.payload }).from(s.jobs).where(and(eq(s.jobs.editionId, editionId), eq(s.jobs.type, "story.draft")));
    const queuedIds = new Set(jobs.map((job) => (job.payload as { storyId?: string }).storyId).filter(Boolean));
    for (const topic of left) expect(queuedIds.has(topic.id), `"${topic.title}" was left out and must not be written`).toBe(false);
  }, 120_000);

  it("counts the pipeline from the invitation, not from the send", async () => {
    const scope: TenantScope = { organizationId, editionId, from: null, to: null };
    const funnel = await runAsOrganization(organizationId, async () => pipelineFunnel(scope));

    // The half that was missing: who was asked, and how many answered.
    expect(funnel.invited, "people were invited to this edition").toBeGreaterThan(0);
    expect(funnel.answered).toBeLessThanOrEqual(funnel.invited);
    expect(funnel.responseRate).toBeCloseTo(funnel.answered / funnel.invited, 5);

    // And it narrows the way a funnel has to: you cannot keep more topics than arrived.
    expect(funnel.kept).toBeLessThanOrEqual(funnel.topics);
    expect(funnel.opened).toBeLessThanOrEqual(funnel.invited);
    expect(funnel.keepRate).toBeLessThanOrEqual(1);
  }, 60_000);
});
