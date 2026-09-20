import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { createOrUpdateCampaign, getCampaignForEdition, setCampaignAudience, setCampaignBrief } from "@/server/campaigns/service";
import { normaliseBrief } from "@/lib/campaigns/brief";

/**
 * Each screen writes what it asks about, and nothing else.
 *
 * This is a regression before it is a feature. The brief — the questions an edition puts to its
 * contributors, the one editorial decision in the whole campaign — was a card on a form whose Save
 * sent eleven fields, and four of them were missing from the type the action took. So the server's
 * defaults won every time: saving a date blanked the brief and put the selection back to drawing
 * at random. Nobody would have seen it happen; they would have seen contributors receive a blank
 * form a week later.
 *
 * So: the brief's own writer touches the brief, the audience's own writer touches the audience,
 * and the full form carries back what it does not edit.
 */
describe("what a campaign screen is allowed to change", () => {
  let editionId: string;
  let userId: string;
  let restore: typeof s.submissionCampaigns.$inferSelect | null = null;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    restore = (await getCampaignForEdition(editionId)) ?? null;
    expect(restore, "the seeded edition has a campaign").toBeTruthy();
    // The seeded campaign has already closed, and a closed campaign is rightly refused. The whole
    // row is put back in afterAll, so this reopens it for the length of this file only.
    await db.update(s.submissionCampaigns).set({ status: "SCHEDULED" }).where(eq(s.submissionCampaigns.id, restore!.id));
  });

  afterAll(async () => {
    if (restore) await db.update(s.submissionCampaigns).set(restore).where(eq(s.submissionCampaigns.id, restore.id));
  });

  it("saves the brief without moving a single date", async () => {
    const before = (await getCampaignForEdition(editionId))!;
    const saved = await setCampaignBrief(
      editionId,
      { asks: [{ kind: "QUESTION", text: "What is the one thing that happened around you?", required: true, wants: ["TEXT", "PHOTO"] }], openContributions: false },
      { id: userId },
    );
    const brief = normaliseBrief(saved.brief);
    expect(brief.asks).toHaveLength(1);
    expect(brief.asks[0].wants).toEqual(["TEXT", "PHOTO"]);
    expect(brief.openContributions).toBe(false);
    for (const key of ["opensAt", "reminder1At", "reminder2At", "deadlineAt", "graceEndsAt"] as const) {
      expect(saved[key].getTime(), key).toBe(before[key].getTime());
    }
    expect(saved.selectionMode).toBe(before.selectionMode);
    expect(saved.contributorGroupIds).toEqual(before.contributorGroupIds);
  });

  it("saves who and when without touching what they are asked for", async () => {
    const before = (await getCampaignForEdition(editionId))!;
    const deadline = new Date(before.opensAt.getTime() + 10 * 86_400_000);
    const saved = await setCampaignAudience(
      editionId,
      { selectionMode: "DRAW", drawCount: 7, contributorGroupIds: [], deadlineAt: deadline.toISOString(), introMessage: "  Tell us what happened.  " },
      { id: userId },
    );
    expect(saved.drawCount).toBe(7);
    expect(saved.introMessage).toBe("Tell us what happened.");
    expect(saved.deadlineAt.getTime()).toBe(deadline.getTime());
    // The reminders are consequences of the deadline, in order and inside the window.
    expect(saved.opensAt.getTime()).toBeLessThan(saved.reminder1At.getTime());
    expect(saved.reminder1At.getTime()).toBeLessThan(saved.reminder2At.getTime());
    expect(saved.reminder2At.getTime()).toBeLessThan(saved.deadlineAt.getTime());
    expect(saved.graceEndsAt.getTime()).toBe(deadline.getTime() + 86_400_000);
    // And the questions are exactly the ones the other screen wrote.
    expect(normaliseBrief(saved.brief).asks).toHaveLength(1);
    expect(normaliseBrief(saved.brief).openContributions).toBe(false);
  });

  it("refuses a deadline that falls before the campaign opens, and changes nothing", async () => {
    const before = (await getCampaignForEdition(editionId))!;
    await expect(
      setCampaignAudience(editionId, { selectionMode: "DRAW", drawCount: 1, contributorGroupIds: [], deadlineAt: new Date(before.opensAt.getTime() - 86_400_000).toISOString() }, { id: userId }),
    ).rejects.toThrow(/last day/i);
    // A refusal is not a partial write: the number asked for is still the one from the save before.
    const after = (await getCampaignForEdition(editionId))!;
    expect(after.drawCount).toBe(7);
    expect(after.deadlineAt.getTime()).toBe(before.deadlineAt.getTime());
  });

  it("brings the opening forward when a campaign that has not gone out is given a sooner deadline", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000);
    await db.update(s.submissionCampaigns).set({ opensAt: new Date(Date.now() + 30 * 86_400_000), status: "SCHEDULED" }).where(eq(s.submissionCampaigns.id, restore!.id));
    const saved = await setCampaignAudience(editionId, { selectionMode: "DRAW", drawCount: 7, contributorGroupIds: [], deadlineAt: soon.toISOString() }, { id: userId });
    // "Ask them sooner than I had planned" means ask them now, not fail.
    expect(saved.opensAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(saved.opensAt.getTime()).toBeLessThan(saved.reminder1At.getTime());
    expect(saved.deadlineAt.getTime()).toBe(soon.getTime());
  });

  it("keeps the brief when the whole form is saved, because the form sends it back", async () => {
    const before = (await getCampaignForEdition(editionId))!;
    const iso = (d: Date) => d.toISOString();
    const saved = await createOrUpdateCampaign(
      editionId,
      {
        name: before.name,
        opensAt: iso(before.opensAt),
        reminder1At: iso(before.reminder1At),
        reminder2At: iso(before.reminder2At),
        deadlineAt: iso(before.deadlineAt),
        graceEndsAt: iso(before.graceEndsAt),
        targets: { ...(before.targets ?? {}) },
        contributorGroupIds: [...before.contributorGroupIds],
        introMessage: before.introMessage,
        autoProcess: before.autoProcess,
        reinvitePrevious: before.reinvitePrevious ?? false,
        selectionMode: before.selectionMode as "DRAW" | "GROUP" | "PEOPLE",
        drawCount: before.drawCount ?? 0,
        selectedContributorIds: [...(before.selectedContributorIds ?? [])],
        brief: normaliseBrief(before.brief),
      },
      { id: userId },
    );
    expect(normaliseBrief(saved.brief).asks).toHaveLength(1);
    expect(saved.drawCount).toBe(7);
    expect(saved.selectionMode).toBe("DRAW");
  });
});
