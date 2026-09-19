import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createOrganization } from "@/server/tenancy/service";
import { createEdition, editionToInheritFrom, inheritedSettings } from "@/server/editions/service";
import { scheduleFromDefaults } from "@/server/campaigns/service";

/**
 * The second edition, which is the one that decides whether anybody uses this.
 *
 * Making the first edition of a title is a setup task and people expect it to take a while. Making
 * the sixth is not: the sections, the shape of the page, the outputs and the people to ask were all
 * decided months ago, and being asked again is the difference between a tool somebody opens every
 * month and one they open twice.
 *
 * So this measures the thing rather than trusting it: configure an edition distinctively, make the
 * next one with nothing but a month, and check every setting came across. And then the part that
 * matters more than convenience — that "the last edition" means the last edition *of this
 * workspace and this title*, because the alternative is one customer's issue inheriting another's.
 */
describe("a new edition starts where the last one left off", () => {
  let organizationId: string;
  let publicationId: string | null;
  let firstId: string;
  let adminId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, seeded.editionId) });
    organizationId = edition!.organizationId!;
    publicationId = edition!.publicationId;
    adminId = edition!.createdById ?? (await db.query.users.findFirst())!.id;

    // An edition configured the way a real one is: not the defaults.
    await runAsOrganization(organizationId, async () => {
      const made = await createEdition({ month: 3, year: 2033, title: "Inheritance test — first", publicationId, targetPageCount: 36, pageCountMode: "fixed", pageSize: "LETTER" }, adminId);
      firstId = made.id;
    });
    await db.update(s.editions).set({ theme: { accentColour: "#0f766e", tagline: "Set once, kept after" } }).where(eq(s.editions.id, firstId));
    await db.delete(s.editionSections).where(eq(s.editionSections.editionId, firstId));
    await db.insert(s.editionSections).values([
      { editionId: firstId, slug: "dispatches", name: "Dispatches", kicker: "From the campuses", colour: "#334155", sortOrder: 0, targetPages: 6 },
      { editionId: firstId, slug: "numbers", name: "The numbers", kicker: null, colour: "#0ea5e9", sortOrder: 1, targetPages: 4 },
    ]);
    await db.delete(s.editionOutputs).where(eq(s.editionOutputs.editionId, firstId));
    await db.insert(s.editionOutputs).values([
      { organizationId, editionId: firstId, format: "EMAIL", status: "READY" },
      { organizationId, editionId: firstId, format: "WEB", status: "READY" },
    ]);
  }, 180_000);

  it("takes the page, the sections, the look and the outputs from the edition before it", async () => {
    let secondId = "";
    await runAsOrganization(organizationId, async () => {
      const second = await createEdition({ month: 4, year: 2033, title: "Inheritance test — second", publicationId }, adminId);
      secondId = second.id;
    });

    const second = await db.query.editions.findFirst({ where: eq(s.editions.id, secondId) });
    expect(second!.targetPageCount, "36 pages, because that is what the last one was").toBe(36);
    expect(second!.pageCountMode).toBe("fixed");
    expect(second!.pageSize).toBe("LETTER");
    expect(second!.theme).toMatchObject({ accentColour: "#0f766e", tagline: "Set once, kept after" });

    const sections = await db
      .select({ slug: s.editionSections.slug, name: s.editionSections.name, kicker: s.editionSections.kicker, targetPages: s.editionSections.targetPages })
      .from(s.editionSections)
      .where(eq(s.editionSections.editionId, secondId))
      .orderBy(asc(s.editionSections.sortOrder));
    expect(sections).toEqual([
      { slug: "dispatches", name: "Dispatches", kicker: "From the campuses", targetPages: 6 },
      { slug: "numbers", name: "The numbers", kicker: null, targetPages: 4 },
    ]);

    const outputs = await db.select({ format: s.editionOutputs.format }).from(s.editionOutputs).where(eq(s.editionOutputs.editionId, secondId));
    expect(outputs.map((output) => output.format).sort(), "what it published as last time, not the title's usual list").toEqual(["EMAIL", "WEB"]);
  }, 120_000);

  it("still lets the caller say what they mean", async () => {
    // Inheritance is a default, not a rule: a caller who names a page size gets that page size.
    let id = "";
    await runAsOrganization(organizationId, async () => {
      const made = await createEdition({ month: 5, year: 2033, title: "Inheritance test — explicit", publicationId, pageSize: "A4", targetPageCount: 12 }, adminId);
      id = made.id;
    });
    const row = await db.query.editions.findFirst({ where: eq(s.editions.id, id) });
    expect(row!.pageSize).toBe("A4");
    expect(row!.targetPageCount).toBe(12);
    // …and what they did not name still comes from the edition before.
    expect(row!.pageCountMode).toBe("fixed");
  }, 120_000);

  it("starts from the platform defaults when asked to start fresh", async () => {
    let id = "";
    await runAsOrganization(organizationId, async () => {
      const made = await createEdition({ month: 6, year: 2033, title: "Inheritance test — fresh", publicationId, inheritFrom: null }, adminId);
      id = made.id;
    });
    const sections = await db.select({ slug: s.editionSections.slug }).from(s.editionSections).where(eq(s.editionSections.editionId, id));
    expect(sections.map((section) => section.slug)).not.toContain("dispatches");
    expect(sections.length).toBeGreaterThan(0);
  }, 120_000);

  it("never inherits from another workspace", async () => {
    // The property that matters more than any of the convenience above.
    const other = await createOrganization({ name: "Southwind Review", type: "COMPANY", locale: "en", timezone: "Europe/London" }, adminId);
    let theirId = "";
    await runAsOrganization(other.id, async () => {
      const made = await createEdition({ month: 4, year: 2033, title: "Southwind — first" }, adminId);
      theirId = made.id;
    });

    // Their edition is the most recent one on the table, and ours must not see it.
    await runAsOrganization(organizationId, async () => {
      const source = await editionToInheritFrom(publicationId);
      expect(source?.organizationId).toBe(organizationId);
      expect(source?.id).not.toBe(theirId);
    });

    // Nor by naming it outright: an id from another workspace resolves to nothing.
    let id = "";
    await runAsOrganization(organizationId, async () => {
      const made = await createEdition({ month: 7, year: 2033, title: "Inheritance test — forged", publicationId, inheritFrom: theirId }, adminId);
      id = made.id;
    });
    const forged = await db.query.editions.findFirst({ where: eq(s.editions.id, id) });
    const theirs = await db.query.editions.findFirst({ where: eq(s.editions.id, theirId) });
    expect(forged!.organizationId).toBe(organizationId);
    expect(forged!.pageSize).not.toBe(theirs!.pageSize === "LETTER" ? "LETTER" : "__never__");

    // And a campaign built for our edition does not take theirs as its starting point.
    await db.update(s.submissionCampaigns).set({ introMessage: "Southwind's private words to its own people" }).where(eq(s.submissionCampaigns.editionId, theirId));
    let ourCampaign: typeof s.submissionCampaigns.$inferSelect | undefined;
    await runAsOrganization(organizationId, async () => {
      let freshId = "";
      const made = await createEdition({ month: 8, year: 2033, title: "Inheritance test — campaign", publicationId }, adminId);
      freshId = made.id;
      await scheduleFromDefaults(freshId, { id: adminId });
      ourCampaign = await db.query.submissionCampaigns.findFirst({ where: eq(s.submissionCampaigns.editionId, freshId) });
    });
    expect(ourCampaign?.introMessage, "another customer's intro message may never become ours").not.toContain("Southwind");
  }, 180_000);

  it("reads back what it will inherit, so the interface can say so before anybody commits", async () => {
    await runAsOrganization(organizationId, async () => {
      const source = await editionToInheritFrom(publicationId);
      const settings = await inheritedSettings(source);
      expect(settings?.from.label).toBeTruthy();
      expect(settings?.sections.length).toBeGreaterThan(0);
    });
  }, 60_000);
});
