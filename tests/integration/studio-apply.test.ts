/**
 * Saying "apply it" and pressing Apply are the same instruction.
 *
 * The planner is faked here, and only the planner: everything after it — staging, the allowance,
 * the restore point, the executor, the re-fit — is the real thing, because the point being checked
 * is that the conversation reaches exactly the code the button reaches.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const planned = {
  reply: "",
  operations: [] as unknown[],
  askFirst: false,
  apply: false,
};

vi.mock("@/server/ai/services/edition-studio", () => ({
  planEditionChange: vi.fn(async () => ({ output: { ...planned }, aiJobId: null, model: "fake", usage: { costCents: 0 } })),
}));

const { db } = await import("@/server/db/client");
const s = await import("@/server/db/schema");
const { ensureSeeded } = await import("../helpers/db");
const { ensureDefaultPlans, backfillSubscriptions } = await import("@/server/billing/plans");
const { converse, studioState } = await import("@/server/editorial/edition-studio/converse");
const { revisionState, discardDraft } = await import("@/server/editorial/edition-studio/revisions");
const { revisionAllowance } = await import("@/server/billing/entitlements");

describe("applying from the conversation", () => {
  let editionId: string;
  let organizationId: string;
  let userId: string;
  let pageIds: string[];

  async function say(message: string, output: Partial<typeof planned>) {
    Object.assign(planned, { reply: "…", operations: [], askFirst: false, apply: false }, output);
    return converse(editionId, { message }, userId);
  }

  beforeAll(async () => {
    const seed = await ensureSeeded();
    await ensureDefaultPlans();
    await backfillSubscriptions();
    editionId = seed.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    const { buildSnapshot } = await import("@/server/editorial/edition-studio/snapshot");
    pageIds = (await buildSnapshot(editionId)).pages.map((page) => page.id);
    await db.update(s.organizationSubscriptions).set({ overrides: { revisionsPerEdition: 9 } }).where(eq(s.organizationSubscriptions.organizationId, organizationId));
  }, 180_000);

  beforeEach(async () => {
    await discardDraft(editionId, userId);
  });

  it("puts what was asked for on the list and changes nothing", async () => {
    const reply = await say("mets une note sur la page 3", {
      reply: "I'll leave a note on page 3.",
      operations: [{ kind: "set_page_notes", pageId: pageIds[2], notes: "From the conversation" }],
    });
    expect(reply.revisions.draft?.changes).toHaveLength(1);
    expect(reply.turns.at(-1)?.intent).toBe("stage");
    const page = await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageIds[2]) });
    expect(page?.notes ?? null).not.toBe("From the conversation");
  }, 120_000);

  it("runs the whole list when the person says to, without anybody pressing a button", async () => {
    await say("mets une note sur la page 3", { reply: "…", operations: [{ kind: "set_page_notes", pageId: pageIds[2], notes: "Said, not clicked" }] });
    const before = await revisionAllowance(organizationId, editionId);

    const reply = await say("applique tout ça maintenant", { reply: "Running it now.", apply: true });

    const last = reply.turns.at(-1)!;
    expect(last.intent).toBe("apply");
    expect(last.content).toMatch(/Revision \d+ is done/);
    // The real thing happened, through the real service.
    const page = await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageIds[2]) });
    expect(page?.notes).toBe("Said, not clicked");
    const after = await revisionAllowance(organizationId, editionId);
    expect(after.used).toBe(before.used + 1);
    expect((await revisionState(editionId)).draft?.changes ?? []).toHaveLength(0);
  }, 180_000);

  it("asks once before spending a revision on something heavy, then does it on the yes", async () => {
    const staged = await say("enlève la page 5", {
      reply: "That would take its story off the paper.",
      operations: [{ kind: "remove_page", pageId: pageIds[4] }],
      askFirst: true,
    });
    expect(staged.revisions.draft?.changes[0].notable).toBe(true);

    const asked = await say("vas-y", { reply: "…", apply: true });
    expect(asked.turns.at(-1)?.intent).toBe("confirm");
    expect(asked.turns.at(-1)?.content).toMatch(/Before I spend the revision/);
    // Nothing spent, nothing run: the page is still there.
    expect(await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageIds[4]) })).toBeTruthy();
    expect((await revisionState(editionId)).draft?.changes).toHaveLength(1);

    const confirmed = await say("oui", { reply: "…", apply: true });
    expect(confirmed.turns.at(-1)?.intent).toBe("apply");
    expect(await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageIds[4]) })).toBeUndefined();
  }, 240_000);

  it("says so rather than throwing when there is nothing waiting", async () => {
    const reply = await say("applique", { reply: "…", apply: true });
    expect(reply.turns.at(-1)?.content).toMatch(/nothing to apply/i);
    expect(reply.turns.at(-1)?.intent).toBe("stage");
  }, 60_000);

  it("refuses in the thread when the plan has no revision left", async () => {
    await db.update(s.organizationSubscriptions).set({ overrides: { revisionsPerEdition: 0 } }).where(eq(s.organizationSubscriptions.organizationId, organizationId));
    await say("note sur la page 4", { reply: "…", operations: [{ kind: "set_page_notes", pageId: pageIds[3], notes: "Never applied" }] });

    const reply = await say("applique", { reply: "…", apply: true });
    expect(reply.turns.at(-1)?.content).toMatch(/could not apply/i);
    // Refused, not lost.
    expect((await studioState(editionId)).revisions.draft?.changes).toHaveLength(1);
    await db.update(s.organizationSubscriptions).set({ overrides: { revisionsPerEdition: 9 } }).where(eq(s.organizationSubscriptions.organizationId, organizationId));
  }, 120_000);
});
