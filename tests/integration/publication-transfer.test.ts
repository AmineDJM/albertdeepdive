import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPublication } from "@/server/publications/service";
import { createEdition } from "@/server/editions/service";
import { cancelTransfer, confirmTransfer, previewTransfer, startTransfer } from "@/server/publications/transfer/service";

/**
 * Handing a newsletter to another workspace.
 *
 * The thing worth testing is not that a row changed owner — it is that nothing was left behind in
 * the workspace that gave it away, because a row that keeps the old organisation is invisible to
 * the newsletter it belongs to and looks to everybody like data loss.
 */
describe("transferring a newsletter", () => {
  let fromOrg: string;
  let toOrg: string;
  let userId: string;
  let adminEmail: string;
  const made: string[] = [];

  beforeAll(async () => {
    await ensureSeeded();
    const orgs = await db.select({ id: s.organizations.id }).from(s.organizations).orderBy(s.organizations.createdAt);
    expect(orgs.length, "the seed makes more than one workspace").toBeGreaterThan(1);
    fromOrg = orgs[0].id;
    toOrg = orgs[1].id;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;

    // The receiving workspace needs somebody who can say yes.
    const existing = await db
      .select({ email: s.users.email })
      .from(s.organizationMembers)
      .innerJoin(s.users, eq(s.users.id, s.organizationMembers.userId))
      .where(and(eq(s.organizationMembers.organizationId, toOrg), inArray(s.organizationMembers.role, ["OWNER", "ADMIN"])));
    if (existing.length) {
      adminEmail = existing[0].email;
    } else {
      await db.insert(s.organizationMembers).values({ organizationId: toOrg, userId, role: "ADMIN" }).onConflictDoNothing();
      adminEmail = (await db.query.users.findFirst({ where: eq(s.users.id, userId) }))!.email;
    }
  });

  afterAll(async () => {
    if (made.length) await db.delete(s.publications).where(inArray(s.publications.id, made));
  });

  async function newTitle(name: string) {
    return runAsOrganization(fromOrg, async () => {
      const row = await createPublication(fromOrg, { name, cadence: "monthly", language: "fr", defaultFormats: ["EMAIL"] }, userId);
      made.push(row.id);
      return row;
    });
  }

  it("counts what would move before anybody confirms anything", async () => {
    const title = await newTitle("Une lettre à confier");
    await runAsOrganization(fromOrg, () => createEdition({ month: 2, year: 2032, publicationId: title.id, inheritFrom: null }, userId));

    const preview = await previewTransfer(title.id, fromOrg);
    expect(preview.publicationName).toBe("Une lettre à confier");
    expect(preview.editions).toBe(1);
  });

  it("refuses a wrong code, counts the attempt, and moves nothing", async () => {
    const title = await newTitle("Une lettre mal confiée");
    const started = await startTransfer({ publicationId: title.id, fromOrganizationId: fromOrg, toOrganizationId: toOrg, requestedById: userId, ownerEmail: "owner@example.test" });

    await expect(
      confirmTransfer({ transferId: started.transferId, fromOrganizationId: fromOrg, ownerCode: started.ownerCode, recipientCode: "000000", userId }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // Still where it was: half a transfer is worse than none.
    const after = await db.query.publications.findFirst({ where: eq(s.publications.id, title.id), columns: { organizationId: true } });
    expect(after!.organizationId).toBe(fromOrg);
    const row = await db.query.publicationTransfers.findFirst({ where: eq(s.publicationTransfers.id, started.transferId) });
    expect(row!.attempts).toBe(1);
    expect(row!.status).toBe("PENDING");

    await cancelTransfer(started.transferId, fromOrg, userId);
  });

  it("never keeps the codes where somebody could read them", async () => {
    const title = await newTitle("Une lettre discrète");
    const started = await startTransfer({ publicationId: title.id, fromOrganizationId: fromOrg, toOrganizationId: toOrg, requestedById: userId, ownerEmail: "owner@example.test" });
    const row = await db.query.publicationTransfers.findFirst({ where: eq(s.publicationTransfers.id, started.transferId) });
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(started.ownerCode);
    expect(stored).not.toContain(started.recipientCode);
    await cancelTransfer(started.transferId, fromOrg, userId);
  });

  it("moves the newsletter, its editions and everything stamped with the old workspace", async () => {
    const title = await newTitle("Une lettre qui déménage");
    const editionIds = await runAsOrganization(fromOrg, async () => {
      const a = await createEdition({ month: 3, year: 2032, publicationId: title.id, inheritFrom: null }, userId);
      const b = await createEdition({ month: 4, year: 2032, publicationId: title.id, inheritFrom: null }, userId);
      return [a.id, b.id];
    });

    const started = await startTransfer({ publicationId: title.id, fromOrganizationId: fromOrg, toOrganizationId: toOrg, requestedById: userId, ownerEmail: "owner@example.test" });
    expect(started.recipientEmail).toBe(adminEmail);

    const { moved } = await confirmTransfer({
      transferId: started.transferId,
      fromOrganizationId: fromOrg,
      ownerCode: started.ownerCode,
      recipientCode: started.recipientCode,
      userId,
    });
    expect(moved.editions).toBe(2);

    const publication = await db.query.publications.findFirst({ where: eq(s.publications.id, title.id), columns: { organizationId: true } });
    expect(publication!.organizationId).toBe(toOrg);

    const editions = await db.select({ organizationId: s.editions.organizationId }).from(s.editions).where(inArray(s.editions.id, editionIds));
    expect(editions.every((e) => e.organizationId === toOrg), "every edition went with it").toBe(true);

    // The real test: nothing anywhere still points at the workspace that gave it away.
    const stragglers = await db
      .select({ id: s.mediaAssets.id })
      .from(s.mediaAssets)
      .where(and(inArray(s.mediaAssets.editionId, editionIds), ne(s.mediaAssets.organizationId, toOrg)));
    expect(stragglers.length, "no row left behind in the old workspace").toBe(0);

    // And the title's look went with it, since a newsletter that arrives unrecognisable has not
    // really arrived.
    const identities = await db
      .select({ organizationId: s.publicationIdentities.organizationId })
      .from(s.publicationIdentities)
      .where(eq(s.publicationIdentities.publicationId, title.id));
    expect(identities.every((row) => row.organizationId === toOrg)).toBe(true);
  });

  it("will not move a newsletter to the workspace it is already in", async () => {
    const title = await newTitle("Une lettre immobile");
    await expect(
      startTransfer({ publicationId: title.id, fromOrganizationId: fromOrg, toOrganizationId: fromOrg, requestedById: userId, ownerEmail: "owner@example.test" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("treats a transfer id as belonging to its workspace, not as a key on its own", async () => {
    const title = await newTitle("Une lettre bien gardée");
    const started = await startTransfer({ publicationId: title.id, fromOrganizationId: fromOrg, toOrganizationId: toOrg, requestedById: userId, ownerEmail: "owner@example.test" });
    await expect(
      confirmTransfer({ transferId: started.transferId, fromOrganizationId: toOrg, ownerCode: started.ownerCode, recipientCode: started.recipientCode, userId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await cancelTransfer(started.transferId, fromOrg, userId);
  });
});
