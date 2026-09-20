import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPublication } from "@/server/publications/service";
import { newsletterShelf } from "@/server/outputs/service";

/**
 * A newsletter is a shelf, and a shelf with nothing on it is not what anybody asked for.
 *
 * Naming a title used to leave you looking at an empty page with a second button to press before
 * anything could happen — a question Briefly can answer for itself, since the first edition of a
 * monthly is next month's, every time. So the title's birth creates it, and the important part is
 * that it is created *the same way the sixth one will be*: same month arithmetic, same issue
 * numbering, same automatic name. A first edition that is special is a first edition nobody can
 * learn from.
 *
 * The shelf reader is checked alongside it, because Home and the title's own page have to agree
 * about which edition is "the" edition — two screens disagreeing about that is how somebody ends
 * up working on last month's.
 */
describe("a new newsletter and its first edition", () => {
  let organizationId: string;
  let userId: string;
  const made: string[] = [];
  const madeEditions: string[] = [];

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, seeded.editionId) });
    organizationId = edition!.organizationId!;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
  }, 180_000);

  afterAll(async () => {
    if (madeEditions.length) await db.delete(s.editions).where(inArray(s.editions.id, madeEditions));
    if (!made.length) return;
    await db.delete(s.editions).where(inArray(s.editions.publicationId, made));
    await db.delete(s.publications).where(inArray(s.publications.id, made));
  });

  it("names the edition itself, numbers it, and puts it on the shelf", async () => {
    const title = await runAsOrganization(organizationId, () =>
      createPublication(organizationId, { name: `Shelf test ${Date.now()}`, cadence: "monthly", language: "en", defaultFormats: ["EMAIL"] }, userId),
    );
    made.push(title.id);

    // The action layer is what pairs the two; here the same pairing is exercised directly, so the
    // test is about the arithmetic rather than about Next's plumbing.
    const { nextEditionMonth, createEdition } = await import("@/server/editions/service");
    const when = await runAsOrganization(organizationId, () => nextEditionMonth());
    const first = await runAsOrganization(organizationId, () => createEdition({ month: when.month, year: when.year, publicationId: title.id }, userId));

    expect(first.label, "named from the month, not left blank for somebody to fill in").toBeTruthy();
    expect(first.issueNumber, "and numbered").toBeGreaterThan(0);
    expect(first.publicationId).toBe(title.id);

    // Renaming is a plain update: automatic by default, the editor's word when they want one.
    const { updateEdition } = await import("@/server/editions/service");
    await runAsOrganization(organizationId, () => updateEdition(first.id, { label: "The launch issue" }, userId));
    const renamed = await db.query.editions.findFirst({ where: eq(s.editions.id, first.id) });
    expect(renamed!.label).toBe("The launch issue");
    expect(renamed!.issueNumber, "renaming does not renumber it").toBe(first.issueNumber);
  }, 120_000);

  it("shows the title on Home's shelf, with the edition being worked on", async () => {
    const shelf = await newsletterShelf(organizationId);
    const mine = shelf.find((title) => made.includes(title.id));
    expect(mine, "a title with an edition is on the shelf").toBeDefined();
    expect(mine!.editions).toBe(1);
    expect(mine!.live, "and the shelf says which edition is in hand").not.toBeNull();
    expect(mine!.live!.status, "a brand-new edition is not published").not.toBe("PUBLISHED");

    // Every title on the shelf belongs to this workspace, which is the one thing a shelf must
    // never get wrong.
    const ids = shelf.map((title) => title.id);
    const rows = await db.select({ organizationId: s.publications.organizationId }).from(s.publications).where(inArray(s.publications.id, ids));
    for (const row of rows) expect(row.organizationId).toBe(organizationId);
  }, 120_000);

  it("counts a published edition as published, and stops calling it the live one", async () => {
    const title = made[0];
    const edition = await db.query.editions.findFirst({ where: and(eq(s.editions.publicationId, title), eq(s.editions.organizationId, organizationId)) });
    await db.update(s.editions).set({ status: "PUBLISHED" }).where(eq(s.editions.id, edition!.id));
    try {
      const shelf = await newsletterShelf(organizationId);
      const mine = shelf.find((each) => each.id === title)!;
      expect(mine.published).toBe(1);
      // Nothing is in progress, so the card offers to start the next one rather than pretending
      // the published issue is still being worked on.
      expect(mine.live!.id, "the newest there is, so the card is not empty").toBe(edition!.id);
      expect(mine.live!.status).toBe("PUBLISHED");
    } finally {
      await db.update(s.editions).set({ status: edition!.status }).where(eq(s.editions.id, edition!.id));
    }
  }, 120_000);
  it("starts the next edition on the shelf the button was pressed on", async () => {
    /*
     * Which newsletter a new edition belongs to.
     *
     * "New edition" took no title at all: it created the next edition of whichever publication the
     * workspace happened to list first. On a shelf with one title that is invisible; on a shelf
     * with two it files September's issue of the quarterly under the monthly, and the month it
     * picked came from the workspace's latest edition rather than from that title's — so the
     * second newsletter was pushed a month further ahead every time the first one advanced.
     */
    const title = made[0];
    const { prepareEdition } = await import("@/server/editions/service");
    const latest = await db.query.editions.findFirst({ where: eq(s.editions.publicationId, title), orderBy: [desc(s.editions.year), desc(s.editions.month)] });
    expect(latest, "the title has its first edition").toBeTruthy();

    const next = await runAsOrganization(organizationId, () => prepareEdition(userId, title));
    madeEditions.push(next.id);
    expect(next.publicationId, "it goes on the shelf it was started from").toBe(title);
    // And it follows that title's own last edition, not the workspace's.
    const expected = latest!.month === 12 ? { month: 1, year: latest!.year + 1 } : { month: latest!.month + 1, year: latest!.year };
    expect({ month: next.month, year: next.year }).toEqual(expected);

    // Named no title, an edition still lands somewhere sensible: the workspace's first.
    const first = await db.query.publications.findFirst({ where: eq(s.publications.organizationId, organizationId), orderBy: [asc(s.publications.sortOrder), asc(s.publications.createdAt)] });
    const unnamed = await runAsOrganization(organizationId, () => prepareEdition(userId));
    madeEditions.push(unnamed.id);
    expect(unnamed.publicationId).toBe(first!.id);
  }, 120_000);
});
