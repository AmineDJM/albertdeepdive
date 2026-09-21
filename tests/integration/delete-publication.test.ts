import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPublication, deletePublication } from "@/server/publications/service";
import { createEdition } from "@/server/editions/service";
import { publicationWithEditions } from "@/server/outputs/service";

/**
 * Removing a newsletter, and what that is allowed to take with it.
 *
 * An edition's link to its title is `set null` rather than a cascade, deliberately: tidying the
 * list of titles must not make published work disappear. So the default refuses and says how many
 * issues are in the way, and there is a second, explicit answer for the title somebody started by
 * mistake — which takes the issues, their files and their contributions with it.
 */
describe("deleting a newsletter", () => {
  let organizationId: string;
  let userId: string;
  const made: string[] = [];

  beforeAll(async () => {
    await ensureSeeded();
    const publication = await db.query.publications.findFirst();
    organizationId = publication!.organizationId;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
  });

  afterAll(async () => {
    if (made.length) await db.delete(s.publications).where(inArray(s.publications.id, made));
  });

  async function newTitle(name: string) {
    return runAsOrganization(organizationId, async () => {
      const row = await createPublication(organizationId, { name, cadence: "monthly", language: "fr", defaultFormats: ["EMAIL"] }, userId);
      made.push(row.id);
      return row;
    });
  }

  it("removes a title nobody ever published under", async () => {
    const title = await newTitle("Une lettre jamais parue");
    await runAsOrganization(organizationId, () => deletePublication(organizationId, title.id, userId));
    expect(await db.query.publications.findFirst({ where: eq(s.publications.id, title.id) })).toBeUndefined();
  });

  it("refuses a title that has issues, and says how many", async () => {
    const title = await newTitle("Une lettre bien réelle");
    await runAsOrganization(organizationId, async () => {
      await createEdition({ month: 3, year: 2031, publicationId: title.id, inheritFrom: null }, userId);
      await createEdition({ month: 4, year: 2031, publicationId: title.id, inheritFrom: null }, userId);
    });

    await expect(runAsOrganization(organizationId, () => deletePublication(organizationId, title.id, userId))).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("2 editions"),
    });
    // And nothing moved: a refusal that half-deleted something would be worse than none.
    expect(await db.query.publications.findFirst({ where: eq(s.publications.id, title.id) })).toBeTruthy();
    expect((await db.select({ id: s.editions.id }).from(s.editions).where(eq(s.editions.publicationId, title.id))).length).toBe(2);
  });

  it("takes the issues with it when that is what was asked", async () => {
    const title = await newTitle("Une lettre commencée par erreur");
    const editionIds = await runAsOrganization(organizationId, async () => {
      const one = await createEdition({ month: 5, year: 2031, publicationId: title.id, inheritFrom: null }, userId);
      const two = await createEdition({ month: 6, year: 2031, publicationId: title.id, inheritFrom: null }, userId);
      return [one.id, two.id];
    });

    const result = await runAsOrganization(organizationId, () => deletePublication(organizationId, title.id, userId, { withEditions: true }));
    expect(result.editionsDeleted).toBe(2);
    expect(await db.query.publications.findFirst({ where: eq(s.publications.id, title.id) })).toBeUndefined();
    expect((await db.select({ id: s.editions.id }).from(s.editions).where(inArray(s.editions.id, editionIds))).length).toBe(0);
    // The sections an edition carries go with it rather than outliving the issue they described.
    expect((await db.select({ id: s.editionSections.id }).from(s.editionSections).where(inArray(s.editionSections.editionId, editionIds))).length).toBe(0);
    const audits = await db.select({ action: s.auditLog.action }).from(s.auditLog).where(eq(s.auditLog.entityId, title.id));
    expect(audits.map((row) => row.action)).toContain("publication.delete");
  });

  it("counts a hidden edition, because deleting the title would take it too", async () => {
    // The screen that asks lists editions with the hidden ones filtered out — rightly, nobody
    // wants to read them. But the deletion does not filter, so a count taken from that list would
    // offer "nothing has been published under it" and then fail on the refusal. The count the
    // dialog reads has to be the count the deletion enforces.
    const title = await newTitle("Une lettre avec un numéro caché");
    const hidden = await runAsOrganization(organizationId, () =>
      createEdition({ month: 7, year: 2031, publicationId: title.id, inheritFrom: null }, userId),
    );
    await db.update(s.editions).set({ hiddenAt: new Date() }).where(eq(s.editions.id, hidden.id));

    const view = await runAsOrganization(organizationId, () => publicationWithEditions(title.id, organizationId));
    expect(view!.editions.map((edition) => edition.id)).not.toContain(hidden.id);
    expect(view!.editionCount).toBe(1);

    await expect(runAsOrganization(organizationId, () => deletePublication(organizationId, title.id, userId))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("says nothing exists rather than what exists, for a title of another workspace", async () => {
    const title = await newTitle("Une lettre d'ailleurs");
    await expect(deletePublication("00000000-0000-0000-0000-000000000000", title.id, userId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.query.publications.findFirst({ where: eq(s.publications.id, title.id) })).toBeTruthy();
  });
});
