import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { createOrganization } from "@/server/tenancy/service";
import { clearOverrides, listPlatformUsers, overrideReport, setOverrides, setPlatformRole, setUserActive } from "@/server/platform/overrides";
import { listWorkspaceRows, platformHealth, recentFailures } from "@/server/platform/dashboard";
import { readLogs } from "@/server/platform/logs";
import { resolveEntitlements } from "@/server/billing/entitlements";
import { ValidationError } from "@/lib/action-result";

/**
 * The platform console reads and writes across every customer, which nothing else in Briefly may do.
 * These tests pin the two things that would hurt if they broke: an override actually changing what a
 * workspace is allowed to do, and the guards that stop a platform locking itself out.
 */
describe("the platform console", () => {
  let albertOrgId: string;
  let partnerOrgId: string;
  let adminId: string;

  beforeAll(async () => {
    await ensureSeeded();
    albertOrgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    partnerOrgId = (await createOrganization({ name: "Pilot Partner", type: "COMPANY", locale: "en", timezone: "Europe/Paris" }, adminId)).id;
  });

  describe("overrides", () => {
    it("shows the plan value next to what the workspace actually gets", async () => {
      const report = await overrideReport(albertOrgId);
      const publications = report.rows.find((row) => row.key === "publications")!;
      expect(publications.planValue).not.toBeUndefined();
      expect(publications.overridden).toBe(false);
      expect(publications.effective).toBe(publications.planValue);
    });

    it("grants a limit the plan does not include, and enforcement sees it", async () => {
      // A free workspace with no subscription row at all — the case overrides are most needed in.
      const before = await resolveEntitlements(partnerOrgId);
      expect(before.entitlements.publications).toBe(1);

      await setOverrides({ organizationId: partnerOrgId, patch: { publications: 12, apiAccess: true }, actorId: adminId, reason: "design partner" });

      const after = await resolveEntitlements(partnerOrgId);
      expect(after.entitlements.publications).toBe(12);
      expect(after.entitlements.apiAccess).toBe(true);
      // The plan itself is untouched — this is a patch, not a new plan.
      expect(after.planKey).toBe(before.planKey);
    });

    it("keeps unlimited and none apart", async () => {
      await setOverrides({ organizationId: partnerOrgId, patch: { users: null }, actorId: adminId });
      expect((await resolveEntitlements(partnerOrgId)).entitlements.users).toBeNull();

      await setOverrides({ organizationId: partnerOrgId, patch: { users: 0 }, actorId: adminId });
      expect((await resolveEntitlements(partnerOrgId)).entitlements.users).toBe(0);
    });

    it("returns one entitlement to the plan without touching the others", async () => {
      await setOverrides({ organizationId: partnerOrgId, patch: { publications: undefined }, actorId: adminId });
      const resolved = await resolveEntitlements(partnerOrgId);
      expect(resolved.entitlements.publications).toBe(1);
      expect(resolved.entitlements.apiAccess).toBe(true);
    });

    it("refuses a limit that is not a limit", async () => {
      await expect(setOverrides({ organizationId: partnerOrgId, patch: { publications: -4 }, actorId: adminId })).rejects.toThrow(ValidationError);
      await expect(setOverrides({ organizationId: partnerOrgId, patch: { publications: 2.5 }, actorId: adminId })).rejects.toThrow(ValidationError);
      await expect(setOverrides({ organizationId: partnerOrgId, patch: { somethingElse: true }, actorId: adminId })).rejects.toThrow(ValidationError);
    });

    it("never leaks one workspace's overrides into another", async () => {
      expect((await resolveEntitlements(partnerOrgId)).entitlements.apiAccess).toBe(true);
      const albert = await overrideReport(albertOrgId);
      expect(albert.rows.filter((row) => row.overridden)).toHaveLength(0);
    });

    it("puts everything back", async () => {
      await clearOverrides(partnerOrgId, adminId);
      const report = await overrideReport(partnerOrgId);
      expect(report.rows.filter((row) => row.overridden)).toHaveLength(0);
      expect((await resolveEntitlements(partnerOrgId)).entitlements.publications).toBe(1);
    });

    it("records who changed what", async () => {
      await setOverrides({ organizationId: partnerOrgId, patch: { webhooks: true }, actorId: adminId, reason: "pilot" });
      const entry = await db.query.auditLog.findFirst({
        where: eq(s.auditLog.action, "platform.overrides"),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
      expect(entry?.userId).toBe(adminId);
      expect(JSON.stringify(entry?.metadata)).toContain("pilot");
      await clearOverrides(partnerOrgId, adminId);
    });
  });

  describe("people", () => {
    it("lists accounts with the workspaces they belong to", async () => {
      const people = await listPlatformUsers();
      const admin = people.find((person) => person.id === adminId)!;
      expect(admin.workspaces.map((w) => w.organizationId)).toContain(albertOrgId);
    });

    it("will not demote or suspend the last platform admin", async () => {
      // A platform nobody can administer is a platform nobody can fix.
      const admins = await db.query.users.findMany({ where: eq(s.users.role, "SUPER_ADMIN") });
      expect(admins).toHaveLength(1);
      await expect(setPlatformRole({ userId: adminId, role: "EDITOR", actorId: adminId })).rejects.toThrow(/last platform admin/i);
      await expect(setUserActive({ userId: adminId, isActive: false, actorId: adminId })).rejects.toThrow(/cannot suspend your own/i);
    });

    it("suspends an account without deleting anything it wrote", async () => {
      const viewer = (await db.query.users.findFirst({ where: eq(s.users.role, "VIEWER") }))!;
      await db.insert(s.sessions).values({ tokenHash: "a".repeat(64), userId: viewer.id, expiresAt: new Date(Date.now() + 86_400_000) });

      await setUserActive({ userId: viewer.id, isActive: false, actorId: adminId });
      const after = await db.query.users.findFirst({ where: eq(s.users.id, viewer.id) });
      expect(after?.isActive).toBe(false);
      // Sessions are gone, the person is not.
      expect(await db.query.sessions.findMany({ where: eq(s.sessions.userId, viewer.id) })).toHaveLength(0);
      expect(after?.name).toBe(viewer.name);

      await setUserActive({ userId: viewer.id, isActive: true, actorId: adminId });
    });
  });

  describe("the dashboard", () => {
    it("counts every customer, not just the current one", async () => {
      const health = await platformHealth();
      expect(health.growth.workspacesTotal).toBeGreaterThanOrEqual(2);
      expect(health.integrations.length).toBeGreaterThan(0);
      expect(health.revenue.mrrCents).toBeGreaterThanOrEqual(0);
    });

    it("lists workspaces with their aggregates in one pass", async () => {
      const rows = await listWorkspaceRows();
      const albert = rows.find((row) => row.id === albertOrgId)!;
      expect(albert.editions).toBeGreaterThan(0);
      expect(albert.members).toBeGreaterThan(0);
      expect(rows.find((row) => row.id === partnerOrgId)?.editions).toBe(0);
    });

    it("has a failures feed that does not throw on an empty platform", async () => {
      await expect(recentFailures(5)).resolves.toBeInstanceOf(Array);
    });
  });

  describe("logs", () => {
    it("merges every source onto one timeline, newest first", async () => {
      const entries = await readLogs({ sinceDays: 365 }, 50);
      expect(entries.length).toBeGreaterThan(0);
      const times = entries.map((entry) => entry.at.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it("narrows to one workspace", async () => {
      const entries = await readLogs({ organizationId: albertOrgId, sinceDays: 365 }, 50);
      expect(entries.every((entry) => entry.organizationId === albertOrgId)).toBe(true);
    });

    it("returns only failures when asked, which excludes actions entirely", async () => {
      const entries = await readLogs({ onlyFailures: true, sinceDays: 365 }, 50);
      expect(entries.every((entry) => entry.failed)).toBe(true);
      expect(entries.some((entry) => entry.source === "audit")).toBe(false);
    });

    it("caps what it returns however much is asked for", async () => {
      expect((await readLogs({ sinceDays: 3650 }, 10_000)).length).toBeLessThanOrEqual(200);
    });
  });
});
