import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { getCampaignForEdition, resolveSelection } from "@/server/campaigns/service";
import { createOrganization } from "@/server/tenancy/service";

/**
 * The three ways of choosing, each asked to produce the people it promises.
 *
 * The interface offers three sentences — *these people*, *this group*, *six of them* — and the
 * value of offering them is entirely in whether the invitations then match. A picker that says
 * "these six" and sends to thirty is worse than no picker, because somebody trusted it.
 *
 * One resolver answers all three, and the preview and the send both call it, so what a person is
 * shown before pressing the button is what happens when they do.
 */
describe("choosing who to ask", () => {
  let editionId: string;
  let campaignId: string;
  let organizationId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    const campaign = await getCampaignForEdition(editionId);
    campaignId = campaign!.id;
  }, 180_000);

  const setMode = async (patch: Partial<typeof s.submissionCampaigns.$inferInsert>) => {
    await db.update(s.submissionCampaigns).set(patch).where(eq(s.submissionCampaigns.id, campaignId));
    return (await db.query.submissionCampaigns.findFirst({ where: eq(s.submissionCampaigns.id, campaignId) }))!;
  };

  it("asks exactly the people named, and nobody else", async () => {
    const people = await db
      .select({ id: s.contributors.id })
      .from(s.contributors)
      .where(and(eq(s.contributors.organizationId, organizationId), eq(s.contributors.isActive, true)))
      .limit(3);
    expect(people.length, "the seed needs contributors for this to mean anything").toBe(3);

    const campaign = await setMode({ selectionMode: "PEOPLE", selectedContributorIds: people.map((p) => p.id) });
    const result = await resolveSelection(campaign);
    expect(result.mode).toBe("PEOPLE");
    expect(result.selected.sort()).toEqual(people.map((p) => p.id).sort());
  }, 60_000);

  it("draws the number asked for, and the same number twice", async () => {
    const campaign = await setMode({ selectionMode: "DRAW", drawCount: 4, targets: {}, selectedContributorIds: [] });
    const once = await resolveSelection(campaign);
    const twice = await resolveSelection(campaign);
    expect(once.mode).toBe("DRAW");
    expect(once.selected.length).toBeLessThanOrEqual(4);
    expect(twice.selected, "the preview is a promise; it may not move between showing and sending").toEqual(once.selected);
  }, 60_000);

  it("invites everybody in the groups when the whole group is asked", async () => {
    const campaign = await setMode({ selectionMode: "GROUP", drawCount: 0, targets: {} });
    const result = await resolveSelection(campaign);
    expect(result.mode).toBe("GROUP");
    expect(result.selected.length, "a whole group is more than a draw of four").toBeGreaterThan(4);
    expect(result.selected.length).toBe(result.poolSize);
  }, 60_000);

  it("keeps the per-campus targets working, because a school newsroom still wants them", async () => {
    const campus = await db.query.campuses.findFirst({ where: eq(s.campuses.isActive, true) });
    if (!campus) return;
    const campaign = await setMode({ selectionMode: "DRAW", drawCount: 0, targets: { [campus.id]: 2 } });
    const result = await resolveSelection(campaign);
    expect(result.selected.length).toBeLessThanOrEqual(2);
    expect(result.byCampus[campus.id] ?? 0).toBe(result.selected.length);
  }, 60_000);

  it("never reaches into another workspace for a named contributor", async () => {
    // The ids live on the campaign row, which is one form edit away from holding anything at all.
    const other = await createOrganization({ name: "Farwind Letter", type: "COMPANY", locale: "en", timezone: "Europe/London" }, (await db.query.users.findFirst())!.id);
    const [theirs] = await db
      .insert(s.contributors)
      .values({ organizationId: other.id, firstName: "Ada", lastName: "Farwind", email: `ada-${Date.now()}@farwind.example`, type: "STAFF" })
      .returning();
    const ours = await db.query.contributors.findFirst({ where: and(eq(s.contributors.organizationId, organizationId), eq(s.contributors.isActive, true)) });

    const campaign = await setMode({ selectionMode: "PEOPLE", selectedContributorIds: [ours!.id, theirs.id] });
    const result = await resolveSelection(campaign);
    expect(result.selected, "another workspace's contributor is not ours to invite").not.toContain(theirs.id);
    expect(result.selected).toContain(ours!.id);
    // And it is counted as asked-for-but-unavailable rather than silently dropped.
    expect(result.shortfall.school).toBe(1);
  }, 120_000);
});
