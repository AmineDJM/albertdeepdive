import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { createOrganization } from "@/server/tenancy/service";
import { backfillSubscriptions, DEFAULT_PLANS, ensureDefaultPlans, getPlanByKey, setDefaultPlan, updatePlan } from "@/server/billing/plans";
import { assignPlan } from "@/server/billing/plans";
import { canPublishFormat, checkLimit, currentUsage, hasFeature, requireLimit, resolveEntitlements, showsBrieflyBranding, usageReport } from "@/server/billing/entitlements";
import { createPublication } from "@/server/publications/service";
import { ForbiddenError, ValidationError } from "@/lib/action-result";

describe("entitlements", () => {
  let adminId: string;
  let freeOrgId: string;
  let albertOrgId: string;

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    await backfillSubscriptions();
    const admin = await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") });
    adminId = admin!.id;
    albertOrgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    const org = await createOrganization({ name: "Limits Ltd", type: "COMPANY" }, adminId);
    freeOrgId = org.id;
    await backfillSubscriptions();
  });

  it("puts a brand-new workspace on the free plan", async () => {
    const plan = await resolveEntitlements(freeOrgId);
    expect(plan.planKey).toBe("free");
    expect(plan.entitlements.publications).toBe(1);
    expect(plan.entitlements.removeBrieflyBranding).toBe(false);
  });

  it("grandfathers a workspace that already had editions", async () => {
    // Dropping a working install to free limits would take away the magazine it already produced.
    const plan = await resolveEntitlements(albertOrgId);
    expect(plan.planKey).not.toBe("free");
    expect(plan.entitlements.printFeatures).toBe(true);
  });

  it("counts what a workspace is actually using", async () => {
    const usage = await currentUsage(albertOrgId);
    expect(usage.users).toBeGreaterThan(0);
    expect(usage.publications).toBeGreaterThan(0);
    const report = await usageReport(albertOrgId);
    expect(report.lines.map((l) => l.key)).toEqual(["publications", "users", "subscribers", "editionsPerMonth"]);
  });

  it("allows up to the limit and refuses past it", async () => {
    const before = await checkLimit(freeOrgId, "publications");
    expect(before).toMatchObject({ allowed: true, used: 0, limit: 1 });

    const created = await createPublication(freeOrgId, { name: "First Title", defaultFormats: ["EMAIL"] });
    expect(created.id).toBeTruthy();

    const after = await checkLimit(freeOrgId, "publications");
    expect(after.allowed).toBe(false);
    expect(after.message).toMatch(/Upgrade/);

    // The rule lives in the service, so every caller is covered, not only the screen.
    await expect(createPublication(freeOrgId, { name: "Second Title", defaultFormats: ["EMAIL"] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireLimit(freeOrgId, "publications")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("climbs the revision ladder once and stops: 1, 3, then unlimited", async () => {
    /*
     * The allowance shipped as 1 / 3 / 10 / unlimited, and the 10 was a number nobody chose. The
     * ladder is one on the free plan, three on the first paid one, and unlimited from the tier
     * above — so this pins the shape rather than the four values, and would fail again on a
     * plausible-looking number invented in the middle of it.
     */
    const ladder = await Promise.all(
      DEFAULT_PLANS.map(async (plan) => ({ key: plan.key, sortOrder: plan.sortOrder, allowance: (await getPlanByKey(plan.key))!.entitlements.revisionsPerEdition ?? null })),
    );
    const climbing = [...ladder].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(climbing.map((tier) => tier.allowance)).toEqual([1, 3, null, null]);
    // Whatever the numbers become, a paid tier never gets less than the free one.
    for (const tier of climbing.slice(1)) {
      if (tier.allowance !== null) expect(tier.allowance, tier.key).toBeGreaterThanOrEqual(climbing[0].allowance as number);
    }
  });

  it("treats null as unlimited and 0 as none", async () => {
    const enterprise = await getPlanByKey("enterprise");
    await assignPlan(freeOrgId, enterprise!.id);
    const unlimited = await checkLimit(freeOrgId, "publications");
    expect(unlimited).toMatchObject({ allowed: true, limit: null });

    const plan = await resolveEntitlements(freeOrgId);
    expect(plan.entitlements.creativeCredits).toBeNull();

    const free = await getPlanByKey("free");
    await assignPlan(freeOrgId, free!.id, { status: "FREE" });
    const freePlan = await resolveEntitlements(freeOrgId);
    expect(freePlan.entitlements.creativeCredits).toBe(0);
  });

  it("gates formats and features by plan", async () => {
    expect(await canPublishFormat(freeOrgId, "EMAIL")).toBe(true);
    expect(await canPublishFormat(freeOrgId, "PRINT")).toBe(false);
    expect(await hasFeature(freeOrgId, "videoGeneration")).toBe(false);
    expect(await showsBrieflyBranding(freeOrgId)).toBe(true);

    const business = await getPlanByKey("business");
    await assignPlan(freeOrgId, business!.id);
    expect(await canPublishFormat(freeOrgId, "PRINT")).toBe(true);
    expect(await hasFeature(freeOrgId, "videoGeneration")).toBe(true);
    expect(await showsBrieflyBranding(freeOrgId)).toBe(false);
  });

  it("falls back to free when a subscription lapses, without taking the data away", async () => {
    const business = await getPlanByKey("business");
    // Stripe retries a failed payment; nothing should change while it does.
    await assignPlan(freeOrgId, business!.id, { status: "PAST_DUE" });
    expect((await resolveEntitlements(freeOrgId)).planKey).toBe("business");

    await assignPlan(freeOrgId, business!.id, { status: "CANCELED" });
    const lapsed = await resolveEntitlements(freeOrgId);
    expect(lapsed.planKey).toBe("free");
    // The workspace still exists, with everything in it.
    const publications = await db.select().from(s.publications).where(eq(s.publications.organizationId, freeOrgId));
    expect(publications.length).toBeGreaterThan(0);
  });

  it("applies a per-workspace override on top of the plan", async () => {
    const free = await getPlanByKey("free");
    await assignPlan(freeOrgId, free!.id, { status: "FREE", overrides: { publications: 25, printFeatures: true } });
    const plan = await resolveEntitlements(freeOrgId);
    expect(plan.planKey).toBe("free");
    expect(plan.entitlements.publications).toBe(25);
    expect(plan.entitlements.printFeatures).toBe(true);
    // Untouched keys still come from the plan.
    expect(plan.entitlements.users).toBe(2);
  });
});

describe("plan administration", () => {
  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
  });

  it("will not let the fallback plan become priced", async () => {
    // A lapsed subscription lands on the default plan; if that plan cost money, it would be a bill
    // nobody agreed to.
    const free = await getPlanByKey("free");
    await expect(updatePlan(free!.id, { priceMonthlyCents: 900 })).rejects.toBeInstanceOf(ValidationError);
    await expect(setDefaultPlan((await getPlanByKey("business"))!.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("lets a super admin change a price without a deploy", async () => {
    const pro = await getPlanByKey("pro");
    await updatePlan(pro!.id, { priceMonthlyCents: 6900, highlights: ["3 publications", "New price"] });
    const updated = await getPlanByKey("pro");
    expect(updated!.priceMonthlyCents).toBe(6900);
    expect(updated!.highlights).toEqual(["3 publications", "New price"]);
    await updatePlan(pro!.id, { priceMonthlyCents: 5900 });
  });

  it("seeds idempotently", async () => {
    const before = await db.select().from(s.plans);
    await ensureDefaultPlans();
    const after = await db.select().from(s.plans);
    expect(after.length).toBe(before.length);
  });
});
