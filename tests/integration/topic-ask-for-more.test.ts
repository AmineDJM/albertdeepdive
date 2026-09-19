import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { askForMore, topicsBoard } from "@/server/editorial/topics";
import { answerInformationRequest } from "@/server/editorial/information-requests";
import { clusterEdition } from "@/server/editorial/clustering";

/**
 * The third answer an editor can give a topic, and the round trip it starts.
 *
 * "Tell me more" is not a decision, and most of what is checked here is that the code agrees. The
 * topic must come back from the question exactly where it was — a board that quietly moves things
 * when you ask about them is a board nobody trusts — and it must come back from the *answer* as
 * itself, not as a second topic beside the first.
 *
 * That last part is the one with teeth. The contributor answers through their own link, which
 * produces a follow-up contribution, and a follow-up contribution is exactly the kind of thing a
 * later clustering pass would happily group into something new. So the answer is followed all the
 * way through: one more source on the same topic, one topic still, nothing duplicated, and a
 * re-cluster afterwards that leaves it alone.
 */
describe("asking the contributor behind a topic for more", () => {
  let editionId: string;
  let userId: string;
  let storyId: string;
  let clusterId: string;
  let originalStatus: string | null = null;
  const made: string[] = [];

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;

    // A topic that actually came from somebody, which is the only kind there is anything to ask
    // about. Whatever it has been decided so far is put back afterwards: the suite shares one
    // database, so this file takes a real seeded topic rather than relying on another file having
    // left an undecided one behind.
    const board = await topicsBoard(editionId);
    const candidate = board.topics.find((topic) => topic.sources > 0 && topic.contributors.length > 0);
    expect(candidate, "the seed has a topic built from real contributions").toBeDefined();
    storyId = candidate!.id;
    originalStatus = candidate!.status;
    clusterId = (await db.query.stories.findFirst({ where: eq(s.stories.id, storyId) }))!.clusterId!;
    await db.update(s.stories).set({ status: "CANDIDATE" }).where(eq(s.stories.id, storyId));
  }, 300_000);

  afterAll(async () => {
    if (!storyId) return;
    if (originalStatus) await db.update(s.stories).set({ status: originalStatus as "CANDIDATE" }).where(eq(s.stories.id, storyId));
    const requests = await db.select({ id: s.informationRequests.id }).from(s.informationRequests).where(eq(s.informationRequests.storyId, storyId));
    if (requests.length) await db.delete(s.informationRequests).where(inArray(s.informationRequests.id, requests.map((row) => row.id)));
    if (made.length) {
      await db.delete(s.storyClusterMembers).where(inArray(s.storyClusterMembers.submissionId, made));
      await db.delete(s.submissions).where(inArray(s.submissions.id, made));
    }
  });

  it("writes to the contributor and leaves the topic exactly where it was", async () => {
    const before = await db.query.stories.findFirst({ where: eq(s.stories.id, storyId) });
    const result = await askForMore(editionId, storyId, "Which teams took part, and on what date?", userId);
    expect(result.alreadyWaiting).toBe(false);
    expect(result.contributor, "the primary contribution's author is who gets asked").not.toBeNull();

    const after = await db.query.stories.findFirst({ where: eq(s.stories.id, storyId) });
    expect(after!.status, "asking a question decides nothing").toBe(before!.status);
    expect(after!.status).toBe("CANDIDATE");

    const request = await db.query.informationRequests.findFirst({ where: eq(s.informationRequests.storyId, storyId) });
    expect(request, "the ask is recorded against this topic").toBeDefined();
    expect(request!.message).toContain("Which teams took part");
    expect(request!.items[0].label).toBe("Which teams took part, and on what date?");
    expect(request!.contributorId).toBe(result.contributor!.id);

    // The contributor got a personal link to complete their contribution on.
    const mail = await db.query.emailLog.findFirst({ where: and(eq(s.emailLog.entityId, request!.id), eq(s.emailLog.template, "information_request")) });
    expect(mail, "the question went out as an email").toBeDefined();
    expect(mail!.html).toMatch(/\/respond\/[A-Za-z0-9._~-]+/);
  }, 300_000);

  it("shows a quiet 'waiting on an answer' on the board, still in To decide", async () => {
    const board = await topicsBoard(editionId);
    const topic = board.topics.find((each) => each.id === storyId)!;
    expect(topic.status, "still undecided").toBe("CANDIDATE");
    expect(topic.moreRequested).toBe(true);
    expect(topic.moreAskedAt).not.toBeNull();
    // And it is still counted among the ones waiting to be decided, not parked somewhere else.
    expect(board.counts.waiting).toBeGreaterThan(0);
  }, 120_000);

  it("does not send a second email while the first is still out", async () => {
    const again = await askForMore(editionId, storyId, "And who organised it?", userId);
    expect(again.alreadyWaiting).toBe(true);
    const requests = await db.select({ id: s.informationRequests.id }).from(s.informationRequests).where(eq(s.informationRequests.storyId, storyId));
    expect(requests).toHaveLength(1);
  }, 120_000);

  it("adds the answer to the same topic: one more source, no new topic, nothing duplicated", async () => {
    const storiesBefore = await db.select({ id: s.stories.id }).from(s.stories).where(eq(s.stories.editionId, editionId));
    const membersBefore = await db.select({ submissionId: s.storyClusterMembers.submissionId }).from(s.storyClusterMembers).where(eq(s.storyClusterMembers.clusterId, clusterId));

    const request = await db.query.informationRequests.findFirst({ where: eq(s.informationRequests.storyId, storyId) });
    // The token is not stored, so the answer is exercised through the same function the public page
    // calls, with a token minted the way the request was created.
    const token = await mintFor(request!.id);
    const { submission } = await answerInformationRequest(token, { answers: { more: "Paris and Lyon took part, on 22 March." } });
    made.push(submission.id);

    const storiesAfter = await db.select({ id: s.stories.id }).from(s.stories).where(eq(s.stories.editionId, editionId));
    expect(storiesAfter.length, "no second topic was created for the answer").toBe(storiesBefore.length);

    const membersAfter = await db.select({ submissionId: s.storyClusterMembers.submissionId }).from(s.storyClusterMembers).where(eq(s.storyClusterMembers.clusterId, clusterId));
    expect(membersAfter.length, "the topic gained exactly one source").toBe(membersBefore.length + 1);
    expect(new Set(membersAfter.map((row) => row.submissionId)).size, "and no contribution is in it twice").toBe(membersAfter.length);
    expect(membersAfter.some((row) => row.submissionId === submission.id)).toBe(true);
  }, 300_000);

  it("goes back to being simply ready to decide once the answer is in", async () => {
    const board = await topicsBoard(editionId);
    const topic = board.topics.find((each) => each.id === storyId)!;
    expect(topic.moreRequested, "nothing is outstanding any more").toBe(false);
    expect(topic.moreAskedAt).toBeNull();
    expect(topic.status, "and it is still the editor's decision to make").toBe("CANDIDATE");
  }, 120_000);

  it("survives a re-cluster: a topic's grouping is not re-shuffled behind the editor", async () => {
    // The failure this guards against: a follow-up contribution is exactly the kind of loose
    // submission a later clustering pass would group into something new, which would put a second
    // topic on the board for a story somebody had already asked about.
    const before = await db.select({ id: s.stories.id }).from(s.stories).where(eq(s.stories.editionId, editionId));
    await clusterEdition(editionId);
    const after = await db.select({ id: s.stories.id }).from(s.stories).where(eq(s.stories.editionId, editionId));
    expect(after.length).toBe(before.length);

    const members = await db.select({ submissionId: s.storyClusterMembers.submissionId }).from(s.storyClusterMembers).where(eq(s.storyClusterMembers.clusterId, clusterId));
    expect(members.some((row) => made.includes(row.submissionId)), "the answer is still on the topic it answered").toBe(true);
  }, 300_000);
});

/**
 * A token whose hash matches the stored one.
 *
 * The raw token only exists in the email, by design. Rather than parse it back out of the HTML,
 * the request's hash is replaced with the hash of a token made here — the same operation the
 * creation path performs, and the only part of the flow a test has to stand in for.
 */
async function mintFor(requestId: string): Promise<string> {
  const { generateOpaqueToken } = await import("@/server/auth/tokens");
  const { token, hash } = generateOpaqueToken();
  await db.update(s.informationRequests).set({ tokenHash: hash }).where(eq(s.informationRequests.id, requestId));
  return token;
}
