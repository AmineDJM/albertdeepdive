import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { getCampaignForEdition, resolveSelection, scheduleCampaign, unscheduleCampaign } from "@/server/campaigns/service";
import { previewInvitation } from "@/server/campaigns/preview";

const DAY = 86_400_000;

/**
 * Read it, then decide — and let the decision be undone until it cannot be.
 *
 * Invitations used to leave on one click with nothing shown beforehand but a number. Three things
 * have to be true for that to be safe: the preview is the email that will actually be sent, the
 * date it is set to leave on can be moved or dropped while it is still unsent, and once it has
 * gone the screen says so rather than offering to send it again.
 */
describe("the invitation, before it goes", () => {
  let editionId: string;
  let userId: string;
  let restore: typeof s.submissionCampaigns.$inferSelect | null = null;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    restore = (await getCampaignForEdition(editionId)) ?? null;
    expect(restore, "the seeded edition has a campaign").toBeTruthy();
    // The seeded campaign has closed. The whole row goes back in afterAll; this file needs one
    // that has not been sent, with a last day far enough away to schedule against.
    await db
      .update(s.submissionCampaigns)
      .set({ status: "DRAFT", closedAt: null, opensAt: new Date(Date.now() - DAY), deadlineAt: new Date(Date.now() + 10 * DAY), graceEndsAt: new Date(Date.now() + 11 * DAY) })
      .where(eq(s.submissionCampaigns.id, restore!.id));
  });

  afterAll(async () => {
    if (restore) await db.update(s.submissionCampaigns).set(restore).where(eq(s.submissionCampaigns.id, restore.id));
  });

  it("shows the email that will be sent, to the people who will get it", async () => {
    const campaign = (await getCampaignForEdition(editionId))!;
    const selection = await resolveSelection(campaign);
    const preview = await previewInvitation(editionId);

    expect(preview.subject.length).toBeGreaterThan(0);
    expect(preview.html).toContain("<html");
    expect(preview.recipients.total).toBe(selection.selected.length);
    expect(preview.recipients.mode).toBe(selection.mode);
    expect(preview.canSend).toBe(selection.selected.length > 0);
    expect(preview.why).toBeNull();
    expect(preview.scheduledFor).toBeNull();

    // The names are the people the sender would actually write to, not a sample of the pool.
    const chosen = await db.select({ firstName: s.contributors.firstName, lastName: s.contributors.lastName }).from(s.contributors).where(inArray(s.contributors.id, selection.selected.length ? selection.selected : ["00000000-0000-0000-0000-000000000000"]));
    const known = new Set(chosen.map((row) => `${row.firstName} ${row.lastName}`.trim()));
    for (const name of preview.recipients.names) expect(known.has(name), name).toBe(true);
    void campaign;
  });

  it("never puts a live contribution link in a preview", async () => {
    const campaignId = (await getCampaignForEdition(editionId))!.id;
    const countRequests = async () => (await db.select({ id: s.submissionRequests.id }).from(s.submissionRequests).where(eq(s.submissionRequests.campaignId, campaignId))).length;
    const before = await countRequests();
    const preview = await previewInvitation(editionId);
    // A token in a preview is a way of submitting on somebody else's behalf.
    expect(preview.html).not.toMatch(/\/contribute\/[A-Za-z0-9_-]{16,}/);
    expect(await countRequests(), "reading the preview creates nothing").toBe(before);
  });

  it("books a date, moves it, and takes it back out", async () => {
    const when = new Date(Date.now() + 2 * DAY);
    const booked = await scheduleCampaign(editionId, when, { id: userId });
    expect(booked.status).toBe("SCHEDULED");
    expect(booked.opensAt.getTime()).toBe(when.getTime());
    // The reminders are a consequence of the span, so they move with the opening.
    expect(booked.reminder1At.getTime()).toBeGreaterThan(when.getTime());
    expect(booked.reminder2At.getTime()).toBeGreaterThan(booked.reminder1At.getTime());
    expect(booked.reminder2At.getTime()).toBeLessThan(booked.deadlineAt.getTime());
    expect((await previewInvitation(editionId)).scheduledFor).toBe(when.toISOString());

    const moved = await scheduleCampaign(editionId, new Date(Date.now() + 3 * DAY), { id: userId });
    expect(moved.opensAt.getTime()).toBeGreaterThan(booked.opensAt.getTime());

    const cancelled = await unscheduleCampaign(editionId, { id: userId });
    expect(cancelled.status).toBe("DRAFT");
    expect((await previewInvitation(editionId)).scheduledFor).toBeNull();
    // Cancelling twice is not an error: the second press means what the first one meant.
    expect((await unscheduleCampaign(editionId, { id: userId })).status).toBe("DRAFT");
  });

  it("refuses a date in the past or after the last day", async () => {
    await expect(scheduleCampaign(editionId, new Date(Date.now() - DAY), { id: userId })).rejects.toMatchObject({ code: "VALIDATION" });
    const campaign = (await getCampaignForEdition(editionId))!;
    await expect(scheduleCampaign(editionId, new Date(campaign.deadlineAt.getTime() + DAY), { id: userId })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await getCampaignForEdition(editionId))!.status, "a refused date changes nothing").toBe("DRAFT");
  });

  it("stops offering to send once the invitations have gone", async () => {
    const campaign = (await getCampaignForEdition(editionId))!;
    await db.update(s.submissionCampaigns).set({ status: "OPEN" }).where(eq(s.submissionCampaigns.id, campaign.id));
    const preview = await previewInvitation(editionId);
    expect(preview.canSend).toBe(false);
    expect(preview.why).toBeTruthy();
    await expect(scheduleCampaign(editionId, new Date(Date.now() + DAY), { id: userId })).rejects.toMatchObject({ code: "CAMPAIGN_ALREADY_OPEN" });
    await expect(unscheduleCampaign(editionId, { id: userId })).rejects.toMatchObject({ code: "CAMPAIGN_ALREADY_OPEN" });
    await db.update(s.submissionCampaigns).set({ status: "DRAFT" }).where(eq(s.submissionCampaigns.id, campaign.id));
  });
});
