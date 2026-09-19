import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createOrganization } from "@/server/tenancy/service";
import { createEdition } from "@/server/editions/service";
import { NotFoundError } from "@/lib/action-result";
import { verifyEdition, workspaceScopeForAdmin, type TenantScope } from "@/server/analytics/scope";
import {
  approvalLatency,
  contributionsByCampus,
  conversionFunnel,
  mostActiveContributors,
  readerDelivery,
  readerDeliveryByEdition,
  responseRateByPool,
  rightsByEdition,
  sectionCoverage,
  submissionTrend,
} from "@/server/analytics/read-insights";
import { editionAnalytics, editionComparison, listEditionOptions } from "@/server/analytics/service";
import { platformTotals, workspaceAnalyticsRows } from "@/server/platform/analytics";

/**
 * The property a multi-tenant SaaS cannot get wrong, checked with numbers that cannot be confused.
 *
 * Two workspaces are given deliberately different figures — Northwind has roughly nine times
 * Eastwind's of everything — and then every customer-facing analytics reader is asked, from inside
 * each, for the same window with no edition picked. That last part is the whole test: "all
 * editions" used to mean every edition on the platform, so the default view of this page added up
 * both customers and showed the total to each of them.
 *
 * Then the ids are tampered with, because a filter that is right until somebody edits a URL is not
 * isolation. And finally the console is asked for the same period, where the sum of the two is the
 * correct answer rather than a leak.
 */

type Figures = { delivered: number; opened: number; clicked: number; bounced: number; submissions: number };

const NORTHWIND: Figures = { delivered: 90, opened: 70, clicked: 30, bounced: 10, submissions: 8 };
const EASTWIND: Figures = { delivered: 10, opened: 4, clicked: 1, bounced: 2, submissions: 5 };

const WINDOW = { from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: null };
const scopeOf = (organizationId: string, editionId: string | null = null): TenantScope => ({ organizationId, editionId, from: WINDOW.from, to: WINDOW.to });

async function seedWorkspace(name: string, slug: string, adminId: string, figures: Figures) {
  const org = await createOrganization({ name, type: "COMPANY", locale: "en", timezone: "Europe/London" }, adminId);
  let editionId = "";
  await runAsOrganization(org.id, async () => {
    const edition = await createEdition({ month: 6, year: 2031, title: `${name} Quarterly`, targetPageCount: 12 }, adminId);
    editionId = edition.id;
  });

  const [contributor] = await db
    .insert(s.contributors)
    .values({ organizationId: org.id, firstName: "Ada", lastName: name, email: `ada@${slug}.example`, type: "STAFF" })
    .returning();

  // Submissions, all inside the window, all this workspace's by way of its edition.
  await db.insert(s.submissions).values(
    Array.from({ length: figures.submissions }, (_, i) => ({
      editionId,
      contributorId: contributor.id,
      title: `${name} story ${i + 1}`,
      description: "Something happened, and somebody wrote it down.",
      status: "ACCEPTED" as const,
      submittedAt: new Date(Date.now() - 60_000),
      reviewedAt: new Date(Date.now() - 30_000),
    })),
  );

  // One delivery-log row per message, with the flags the reader counts.
  const sent = figures.delivered + figures.bounced;
  await db.insert(s.emailLog).values(
    Array.from({ length: sent }, (_, i) => {
      const bounced = i >= figures.delivered;
      return {
        organizationId: org.id,
        editionId,
        to: `reader${i}@${slug}.example`,
        subject: `${name} issue`,
        html: "<p>Hello</p>",
        template: "edition_email",
        status: "SENT" as const,
        sentAt: new Date(),
        deliveredAt: bounced ? null : new Date(),
        bouncedAt: bounced ? new Date() : null,
        openedAt: !bounced && i < figures.opened ? new Date() : null,
        clickedAt: !bounced && i < figures.clicked ? new Date() : null,
        opens: !bounced && i < figures.opened ? 1 : 0,
        clicks: !bounced && i < figures.clicked ? 1 : 0,
      };
    }),
  );

  return { organizationId: org.id, editionId };
}

describe("analytics never cross a workspace", () => {
  let northwind: { organizationId: string; editionId: string };
  let eastwind: { organizationId: string; editionId: string };

  beforeAll(async () => {
    await ensureSeeded();
    const admin = await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") });
    northwind = await seedWorkspace("Northwind Media", "northwind", admin!.id, NORTHWIND);
    eastwind = await seedWorkspace("Eastwind Press", "eastwind", admin!.id, EASTWIND);
  }, 120_000);

  it("counts one workspace's readers and not the other's", async () => {
    const north = await readerDelivery(scopeOf(northwind.organizationId));
    expect(north.delivered).toBe(NORTHWIND.delivered);
    expect(north.opened).toBe(NORTHWIND.opened);
    expect(north.clicked).toBe(NORTHWIND.clicked);
    expect(north.bounced).toBe(NORTHWIND.bounced);

    const east = await readerDelivery(scopeOf(eastwind.organizationId));
    expect(east.delivered).toBe(EASTWIND.delivered);
    expect(east.opened).toBe(EASTWIND.opened);
    expect(east.clicked).toBe(EASTWIND.clicked);
    expect(east.bounced).toBe(EASTWIND.bounced);

    // Neither is the sum, which is what the page used to show both of them.
    expect(north.delivered + east.delivered).toBe(NORTHWIND.delivered + EASTWIND.delivered);
    expect(north.delivered).not.toBe(NORTHWIND.delivered + EASTWIND.delivered);
  });

  it("counts one workspace's submissions and not the other's, with no edition picked", async () => {
    const north = await conversionFunnel(scopeOf(northwind.organizationId));
    const east = await conversionFunnel(scopeOf(eastwind.organizationId));
    expect(north.steps[0].value).toBe(NORTHWIND.submissions);
    expect(east.steps[0].value).toBe(EASTWIND.submissions);

    expect((await submissionTrend(scopeOf(northwind.organizationId))).total).toBe(NORTHWIND.submissions);
    expect((await submissionTrend(scopeOf(eastwind.organizationId))).total).toBe(EASTWIND.submissions);

    expect((await approvalLatency(scopeOf(northwind.organizationId))).reviewed).toBe(NORTHWIND.submissions);
    expect((await approvalLatency(scopeOf(eastwind.organizationId))).reviewed).toBe(EASTWIND.submissions);
  });

  it("lists only this workspace's editions, in the picker and in every list keyed by edition", async () => {
    const options = await listEditionOptions(scopeOf(northwind.organizationId));
    expect(options.map((o) => o.id)).toEqual([northwind.editionId]);

    const comparison = await editionComparison(scopeOf(northwind.organizationId));
    expect(comparison.map((row) => row.id)).toEqual([northwind.editionId]);

    const coverage = await sectionCoverage(scopeOf(northwind.organizationId));
    expect(coverage.editions.map((e) => e.id)).toEqual([northwind.editionId]);

    const byEdition = await readerDeliveryByEdition(scopeOf(northwind.organizationId));
    expect(byEdition.map((row) => row.editionId)).toEqual([northwind.editionId]);
    expect(byEdition[0].delivered).toBe(NORTHWIND.delivered);
  });

  it("keeps every other reader inside the workspace too", async () => {
    const [northTop, eastTop] = await Promise.all([
      mostActiveContributors(scopeOf(northwind.organizationId)),
      mostActiveContributors(scopeOf(eastwind.organizationId)),
    ]);
    expect(northTop.every((row) => row.name.includes("Northwind"))).toBe(true);
    expect(eastTop.every((row) => row.name.includes("Eastwind"))).toBe(true);
    expect(northTop[0]?.submissions).toBe(NORTHWIND.submissions);

    // A workspace with no campuses, no groups and no pictures of its own sees empty, not somebody
    // else's — the seeded demo newsroom has plenty of all three.
    expect(await contributionsByCampus(scopeOf(northwind.organizationId))).toEqual([]);
    expect(await responseRateByPool(scopeOf(northwind.organizationId))).toEqual([]);
    expect(await rightsByEdition(scopeOf(northwind.organizationId))).toEqual([]);

    const analytics = await editionAnalytics(scopeOf(northwind.organizationId));
    expect(analytics.submissions.total).toBe(NORTHWIND.submissions);
    expect(analytics.media.total).toBe(0);
    // The publication block used to fall back to the latest READY version anywhere on the platform.
    expect(analytics.publication).toBeNull();
  });

  it("refuses an edition id belonging to somebody else", async () => {
    await expect(verifyEdition(eastwind.editionId, northwind.organizationId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(verifyEdition(northwind.editionId, eastwind.organizationId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(verifyEdition("11111111-1111-4111-8111-111111111111", northwind.organizationId)).rejects.toBeInstanceOf(NotFoundError);
    // Its own is fine, and "none picked" stays none.
    expect(await verifyEdition(northwind.editionId, northwind.organizationId)).toBe(northwind.editionId);
    expect(await verifyEdition(null, northwind.organizationId)).toBeNull();
  });

  it("returns nothing rather than somebody else's figures if a foreign id reaches a query anyway", async () => {
    // Belt to the braces: a scope forged by hand, skipping the door that would have refused it.
    const forged = scopeOf(northwind.organizationId, eastwind.editionId);
    expect((await readerDelivery(forged)).delivered).toBe(0);
    expect((await conversionFunnel(forged)).steps[0].value).toBe(0);
    expect((await submissionTrend(forged)).total).toBe(0);
    expect(await readerDeliveryByEdition(forged)).toEqual([]);
  });

  it("gives the Super Admin both workspaces and the platform total", async () => {
    const totals = await platformTotals(7);
    expect(totals.reach.delivered).toBeGreaterThanOrEqual(NORTHWIND.delivered + EASTWIND.delivered);
    expect(totals.reach.opened).toBeGreaterThanOrEqual(NORTHWIND.opened + EASTWIND.opened);
    expect(totals.workspaces).toBeGreaterThanOrEqual(3);

    const rows = await workspaceAnalyticsRows(7);
    const north = rows.find((row) => row.id === northwind.organizationId)!;
    const east = rows.find((row) => row.id === eastwind.organizationId)!;
    expect(north.reach.delivered).toBe(NORTHWIND.delivered);
    expect(east.reach.delivered).toBe(EASTWIND.delivered);
    expect(north.submissions).toBe(NORTHWIND.submissions);
    expect(east.submissions).toBe(EASTWIND.submissions);
  });

  it("drills the Super Admin into one named workspace, and no further", async () => {
    const scope = await workspaceScopeForAdmin(eastwind.organizationId, WINDOW);
    expect(scope.organizationId).toBe(eastwind.organizationId);
    expect((await readerDelivery(scope)).delivered).toBe(EASTWIND.delivered);

    // Even for staff, one scope names one workspace: there is no value that means "all of them".
    await expect(workspaceScopeForAdmin("11111111-1111-4111-8111-111111111111", WINDOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(workspaceScopeForAdmin(eastwind.organizationId, WINDOW, northwind.editionId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
