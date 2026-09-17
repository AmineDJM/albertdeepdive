import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { addMember, createOrganization, listMembers, removeMember, setMemberRole } from "@/server/tenancy/service";
import { createContributor, getContributor, listCampusesWithStats, listContributors, listGroups, listPrograms, createCampus, createGroup } from "@/server/contributors/service";
import { createRecipient, getRecipient, listRecipients } from "@/server/audience/service";
import { createEdition, getEdition, listEditions } from "@/server/editions/service";
import { activeBrand, ensureBrand, saveBrand } from "@/server/brand/service";
import { NotFoundError } from "@/lib/action-result";

/**
 * Multi-tenancy is the one property a SaaS cannot get wrong: a customer must never see another
 * customer's newsroom. These tests set up two workspaces and then try, from inside each, to reach
 * the other's rows — by listing, and by asking for a known id directly.
 */
describe("tenant isolation", () => {
  let albertOrgId: string;
  let rivalOrgId: string;
  let adminId: string;
  let albertEditionId: string;
  let rivalEditionId: string;
  let albertContributorId: string;
  let rivalContributorId: string;

  beforeAll(async () => {
    await ensureSeeded();
    const albert = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") });
    albertOrgId = albert!.id;
    const admin = await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") });
    adminId = admin!.id;

    const rival = await createOrganization({ name: "Northwind Ventures", type: "INVESTOR", locale: "en", timezone: "Europe/London" }, adminId);
    rivalOrgId = rival.id;

    albertEditionId = (await db.query.editions.findFirst({ where: eq(s.editions.organizationId, albertOrgId) }))!.id;

    await runAsOrganization(rivalOrgId, async () => {
      const edition = await createEdition({ month: 3, year: 2030, title: "Northwind Quarterly", targetPageCount: 12 }, adminId);
      rivalEditionId = edition.id;
      const c = await createContributor({ firstName: "Nora", lastName: "Vance", email: "nora@northwind.example", type: "STAFF", groupIds: [] }, adminId);
      rivalContributorId = c.id;
      await createCampus({ name: "London Office" }, adminId);
      await createGroup({ name: "Partners" }, adminId);
      await createRecipient({ firstName: "Limited", lastName: "Partner", email: "lp@northwind.example", segment: "PARTNER" }, adminId);
    });

    await runAsOrganization(albertOrgId, async () => {
      const c = await createContributor({ firstName: "Amine", lastName: "Test", email: "amine.test@albertschool.example", type: "STUDENT", groupIds: [] }, adminId);
      albertContributorId = c.id;
    });
  });

  it("stamps every row a workspace creates with that workspace", async () => {
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, rivalEditionId) });
    const contributor = await db.query.contributors.findFirst({ where: eq(s.contributors.id, rivalContributorId) });
    expect(edition?.organizationId).toBe(rivalOrgId);
    expect(contributor?.organizationId).toBe(rivalOrgId);
  });

  it("never lists another workspace's editions", async () => {
    const albertList = await runAsOrganization(albertOrgId, () => listEditions());
    const rivalList = await runAsOrganization(rivalOrgId, () => listEditions());
    expect(albertList.map((e) => e.id)).toContain(albertEditionId);
    expect(albertList.map((e) => e.id)).not.toContain(rivalEditionId);
    expect(rivalList.map((e) => e.id)).toEqual([rivalEditionId]);
  });

  it("never lists another workspace's people, campuses, groups, programmes or audience", async () => {
    const rival = await runAsOrganization(rivalOrgId, async () => ({
      contributors: await listContributors(),
      campuses: await listCampusesWithStats(),
      groups: await listGroups(),
      programs: await listPrograms(),
      recipients: await listRecipients(),
    }));
    expect(rival.contributors.map((c) => c.id)).toEqual([rivalContributorId]);
    expect(rival.campuses.map((c) => c.name)).toEqual(["London Office"]);
    expect(rival.groups.map((g) => g.name)).toEqual(["Partners"]);
    expect(rival.programs).toHaveLength(0);
    expect(rival.recipients.map((r) => r.email)).toEqual(["lp@northwind.example"]);

    const albert = await runAsOrganization(albertOrgId, () => listContributors());
    expect(albert.map((c) => c.id)).toContain(albertContributorId);
    expect(albert.map((c) => c.id)).not.toContain(rivalContributorId);
    expect(albert.length).toBeGreaterThan(1);
  });

  it("reports another workspace's row as not found, not as forbidden", async () => {
    // "Not found" is deliberate: "forbidden" would confirm the id exists somewhere on the platform.
    await expect(runAsOrganization(albertOrgId, () => getEdition(rivalEditionId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(runAsOrganization(albertOrgId, () => getContributor(rivalContributorId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(runAsOrganization(rivalOrgId, () => getEdition(albertEditionId))).rejects.toBeInstanceOf(NotFoundError);
    await expect(runAsOrganization(rivalOrgId, () => getContributor(albertContributorId))).rejects.toBeInstanceOf(NotFoundError);

    const recipient = (await runAsOrganization(rivalOrgId, () => listRecipients()))[0];
    await expect(runAsOrganization(albertOrgId, () => getRecipient(recipient.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(runAsOrganization(rivalOrgId, () => getRecipient(recipient.id))).resolves.toMatchObject({ id: recipient.id });
  });

  it("gives the creator ownership and keeps at least one owner", async () => {
    const members = await listMembers(rivalOrgId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: adminId, role: "OWNER" });

    await expect(setMemberRole(rivalOrgId, adminId, "EDITOR")).rejects.toThrow(/at least one owner/i);
    await expect(removeMember(rivalOrgId, adminId)).rejects.toThrow(/at least one owner/i);

    const viewer = await db.query.users.findFirst({ where: eq(s.users.role, "VIEWER") });
    await addMember(rivalOrgId, viewer!.id, "ADMIN", adminId);
    expect(await listMembers(rivalOrgId)).toHaveLength(2);
    // With a second owner in place the first one may step down.
    await setMemberRole(rivalOrgId, viewer!.id, "OWNER");
    await expect(setMemberRole(rivalOrgId, adminId, "EDITOR")).resolves.toMatchObject({ role: "EDITOR" });
  });

  it("gives each workspace its own brand, and only ever one active version", async () => {
    // A brand is the input to every renderer, so a leak here would put one customer's colours on
    // another customer's magazine.
    const albert = await activeBrand(albertOrgId);
    expect(albert?.system.colours.brand).toBe("#10203A");

    const rival = await ensureBrand(rivalOrgId);
    expect(rival.organizationId).toBe(rivalOrgId);
    expect(rival.id).not.toBe(albert!.id);

    await saveBrand({ organizationId: rivalOrgId, system: { ...rival.system, colours: { ...rival.system.colours, brand: "#7A1F3D" } }, actorId: adminId });

    // The new version is active, the old one is kept, and Albert is untouched.
    const rows = await db.query.brandSystems.findMany({ where: eq(s.brandSystems.organizationId, rivalOrgId) });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
    expect((await activeBrand(rivalOrgId))!.system.colours.brand).toBe("#7A1F3D");
    expect((await activeBrand(albertOrgId))!.system.colours.brand).toBe("#10203A");
  });

  it("refuses a brand that is not a brand", async () => {
    await expect(saveBrand({ organizationId: rivalOrgId, system: { colours: { brand: "#fff" } }, actorId: adminId })).rejects.toThrow(/not valid/i);
  });

  it("keeps workspace slugs unique even when two customers share a name", async () => {
    const a = await createOrganization({ name: "Acme", type: "COMPANY" }, adminId);
    const b = await createOrganization({ name: "Acme", type: "COMPANY" }, adminId);
    expect(a.slug).toBe("acme");
    expect(b.slug).toBe("acme-2");
    expect(b.id).not.toBe(a.id);
  });
});
