import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { getCampaignForEdition, resolveSelection, setCampaignAudience } from "@/server/campaigns/service";

/**
 * "Six of them" and "and Marie, whatever happens" are not competing instructions.
 *
 * Naming somebody only counted in the mode called "the people I choose", so an editor drawing six
 * from a pool had no way to add the one person they had just thought of — and a workspace with no
 * groups yet, which is every workspace on its first day, could not ask anybody at all: the screen
 * said "of the 0 people in the groups below" and that was the end of it.
 */
describe("people named by hand", () => {
  let editionId: string;
  let userId: string;
  let restore: typeof s.submissionCampaigns.$inferSelect | null = null;
  let named: string[] = [];

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    restore = (await getCampaignForEdition(editionId)) ?? null;
    await db.update(s.submissionCampaigns).set({ status: "SCHEDULED" }).where(eq(s.submissionCampaigns.id, restore!.id));
    const people = await db.select({ id: s.contributors.id }).from(s.contributors).where(eq(s.contributors.isActive, true)).limit(2);
    named = people.map((row) => row.id);
    expect(named.length, "the seed has contributors to name").toBe(2);
  });

  afterAll(async () => {
    if (restore) await db.update(s.submissionCampaigns).set(restore).where(eq(s.submissionCampaigns.id, restore.id));
  });

  it("asks them on top of a draw", async () => {
    await setCampaignAudience(editionId, { selectionMode: "DRAW", drawCount: 2, selectedContributorIds: [] }, { id: userId });
    const drawn = await resolveSelection((await getCampaignForEdition(editionId))!);

    await setCampaignAudience(editionId, { selectedContributorIds: named }, { id: userId });
    const withNamed = await resolveSelection((await getCampaignForEdition(editionId))!);

    expect(withNamed.mode).toBe("DRAW");
    for (const id of named) expect(withNamed.selected).toContain(id);
    // The draw itself is untouched: the named are added, not substituted for somebody drawn.
    for (const id of drawn.selected) expect(withNamed.selected).toContain(id);
    expect(withNamed.selected.length).toBe(new Set([...drawn.selected, ...named]).size);
  });

  it("asks them on top of a group", async () => {
    const campaign = (await getCampaignForEdition(editionId))!;
    await setCampaignAudience(editionId, { selectionMode: "GROUP", contributorGroupIds: campaign.contributorGroupIds, selectedContributorIds: named }, { id: userId });
    const selection = await resolveSelection((await getCampaignForEdition(editionId))!);
    expect(selection.mode).toBe("GROUP");
    for (const id of named) expect(selection.selected).toContain(id);
    // No duplicates, whether or not the named people are in the groups as well.
    expect(new Set(selection.selected).size).toBe(selection.selected.length);
  });

  it("still asks nobody else when the mode is exactly these people", async () => {
    await setCampaignAudience(editionId, { selectionMode: "PEOPLE", selectedContributorIds: named }, { id: userId });
    const selection = await resolveSelection((await getCampaignForEdition(editionId))!);
    expect(selection.mode).toBe("PEOPLE");
    expect([...selection.selected].sort()).toEqual([...named].sort());
  });

  it("ignores an id that is not an active contributor of this workspace", async () => {
    await setCampaignAudience(editionId, { selectionMode: "PEOPLE", selectedContributorIds: [...named, "00000000-0000-0000-0000-000000000000"] }, { id: userId });
    const selection = await resolveSelection((await getCampaignForEdition(editionId))!);
    expect(selection.selected).not.toContain("00000000-0000-0000-0000-000000000000");
    expect(selection.selected.length).toBe(2);
  });
});
