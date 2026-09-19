/**
 * Revisions on the seeded test database.
 *
 * The thing being checked is the promise the product makes to the person paying: nothing happens
 * until you press, the list you read is the list that runs, and the count you are shown is enforced
 * on the server rather than by a hidden button.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { backfillSubscriptions, ensureDefaultPlans } from "@/server/billing/plans";
import { revisionAllowance } from "@/server/billing/entitlements";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { buildSnapshot } from "@/server/editorial/edition-studio/snapshot";
import { applyRevision, discardDraft, namesFrom, removeChange, revisionState, stage, undoRevision } from "@/server/editorial/edition-studio/revisions";
import type { EditionOperation } from "@/server/editorial/edition-studio/operations";

describe("revisions", () => {
  let editionId: string;
  let organizationId: string;
  let userId: string;
  let pageIds: string[];
  let names: ReturnType<typeof namesFrom>;

  /** Changes the plan's allowance for this workspace only, the way a negotiated limit would. */
  async function allow(n: number | null) {
    await db
      .update(s.organizationSubscriptions)
      .set({ overrides: { revisionsPerEdition: n } })
      .where(eq(s.organizationSubscriptions.organizationId, organizationId));
  }

  const note = (pageId: string, text: string | null): EditionOperation => ({ kind: "set_page_notes", pageId, notes: text });

  beforeAll(async () => {
    const seed = await ensureSeeded();
    await ensureDefaultPlans();
    await backfillSubscriptions();
    editionId = seed.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    const snapshot = await buildSnapshot(editionId);
    pageIds = snapshot.pages.map((p) => p.id);
    names = namesFrom(snapshot);
    expect(pageIds.length).toBeGreaterThan(3);
  }, 120_000);

  it("puts what was asked for on a list and changes nothing yet", async () => {
    await stage(editionId, [note(pageIds[2], "Check the caption")], { names, userId });
    const state = await revisionState(editionId);
    expect(state.draft?.status).toBe("DRAFT");
    expect(state.draft?.changes).toHaveLength(1);
    expect(state.draft?.number).toBeNull();

    // The page itself is untouched: a conversation is not an edit.
    const page = await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageIds[2]) });
    expect(page?.notes ?? null).not.toBe("Check the caption");
    expect(state.history).toHaveLength(0);
  });

  it("writes each line in words, with the page named rather than its id", async () => {
    const state = await revisionState(editionId);
    const line = state.draft!.changes[0];
    expect(line.text).toBe("Leave a note on page {page}");
    expect(line.values).toEqual({ page: 3 });
    expect(line.notable).toBe(false);
  });

  it("replaces a line when the same thing is asked for twice", async () => {
    const before = (await revisionState(editionId)).draft!.changes.length;
    const result = await stage(editionId, [note(pageIds[2], "Actually, check the byline")], { names, userId });
    expect(result.replaced).toBe(1);
    expect(result.changes).toHaveLength(before);
    const op = result.changes.at(-1)!.op as Extract<EditionOperation, { kind: "set_page_notes" }>;
    expect(op.notes).toBe("Actually, check the byline");
  });

  it("keeps two different pages as two lines", async () => {
    const result = await stage(editionId, [note(pageIds[3], "Second thought")], { names, userId });
    expect(result.replaced).toBe(0);
    expect(result.changes).toHaveLength(2);
  });

  it("takes a line off the list, and refuses one that is not on it", async () => {
    const state = await revisionState(editionId);
    const removed = await removeChange(editionId, state.draft!.changes[1].id, userId);
    expect(removed.changes).toHaveLength(1);
    await expect(removeChange(editionId, "00000000-0000-4000-8000-000000000000", userId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses to spend a revision on an empty list", async () => {
    await discardDraft(editionId, userId);
    await expect(applyRevision(editionId, userId)).rejects.toBeInstanceOf(ValidationError);
  });

  it("spends one revision when the list is applied, and does what was on it", async () => {
    await allow(2);
    await stage(editionId, [note(pageIds[2], "Caption checked")], { names, userId });
    const { revision, allowance } = await applyRevision(editionId, userId);

    expect(revision.status).toBe("APPLIED");
    expect(revision.number).toBe(1);
    expect(revision.outcomes.every((o) => o.ok)).toBe(true);
    expect(revision.appliedAt).toBeTruthy();

    const page = await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageIds[2]) });
    expect(page?.notes).toBe("Caption checked");

    expect(allowance).toMatchObject({ used: 1, limit: 2, remaining: 1, allowed: true });
    const state = await revisionState(editionId);
    expect(state.draft?.changes ?? []).toHaveLength(0);
    expect(state.history).toHaveLength(1);
  }, 120_000);

  it("counts revisions against the issue, not the month", async () => {
    // A second issue on the same workspace starts with its full allowance.
    const seed = await ensureSeeded();
    const other = await revisionAllowance(organizationId, seed.nextEditionId);
    expect(other).toMatchObject({ used: 0, remaining: 2 });
  });

  it("refuses the next one once the plan's revisions for this issue are gone", async () => {
    await allow(1);
    await stage(editionId, [note(pageIds[3], "One too many")], { names, userId });
    await expect(applyRevision(editionId, userId)).rejects.toBeInstanceOf(ForbiddenError);

    // Refused, not lost: the list is still there to apply on a bigger plan.
    const state = await revisionState(editionId);
    expect(state.draft?.changes).toHaveLength(1);
    expect(state.allowance).toMatchObject({ used: 1, limit: 1, remaining: 0, allowed: false });
    expect(state.allowance.message).toMatch(/Upgrade/);
  });

  it("lets an unlimited plan keep going", async () => {
    await allow(null);
    const { revision, allowance } = await applyRevision(editionId, userId);
    expect(revision.number).toBe(2);
    expect(allowance).toMatchObject({ limit: null, remaining: null, allowed: true });
  }, 120_000);

  it("puts the issue back without refunding the revision", async () => {
    const before = await revisionState(editionId);
    const applied = before.history.find((r) => r.number === 2)!;
    const page = await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageIds[3]) });
    expect(page?.notes).toBe("One too many");

    await undoRevision(editionId, applied.id, userId);
    const after = await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, pageIds[3]) });
    expect(after?.notes ?? null).not.toBe("One too many");

    await allow(5);
    // The work was done and the renders were made; undoing is a judgement about the result.
    expect(await revisionAllowance(organizationId, editionId)).toMatchObject({ used: 2, remaining: 3 });
  }, 120_000);

  it("re-measures the issue once for a basket that changes the paper", async () => {
    await stage(editionId, [{ kind: "set_extent", mode: "auto", pages: null }], { names, userId });
    const { revision } = await applyRevision(editionId, userId);
    const layout = revision.rerenders.find((r) => r.subject === "LAYOUT");
    expect(layout?.ok, layout?.detail).toBe(true);
    expect(layout?.detail).toMatch(/Re-measured: \d+ pages/);
  }, 300_000);
});
