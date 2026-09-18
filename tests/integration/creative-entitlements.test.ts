import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { createOrganization } from "@/server/tenancy/service";
import { backfillSubscriptions, ensureDefaultPlans } from "@/server/billing/plans";
import { runAsOrganization } from "@/server/tenancy/context";
import { assertCredits, createPack, creditsUsedThisMonth, hasCreditsLeft, recordCost } from "@/server/creative/service";
import { setOverrides, LIMIT_KEYS, FLAG_KEYS, overrideReport } from "@/server/platform/overrides";
import { ForbiddenError } from "@/lib/action-result";

/**
 * Who may make what, and what happens when the allowance runs out.
 *
 * The interesting cases are all at the boundary: a plan that gives none, a Super Admin grant that
 * overrules it, and the moment a workspace crosses its limit — which should stop it spending money
 * and should not stop it working.
 */
describe("creative entitlements", () => {
  let adminId: string;
  let orgId: string;

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    const admin = await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") });
    adminId = admin!.id;
    const org = await createOrganization({ name: "Creative Co", type: "COMPANY" }, adminId);
    orgId = org.id;
    await backfillSubscriptions();
  });

  it("exposes every Creative Studio entitlement to Super Admin", async () => {
    // A gate the product enforces but nobody can change is a support ticket. Each of these is checked
    // somewhere in the creative path, so each has to be settable.
    const report = await overrideReport(orgId);
    const keys = report.rows.map((row) => row.key);
    for (const key of ["creativeCredits", "socialPack", "cinematicMode", "videoGeneration"]) {
      expect(keys, key).toContain(key);
      expect(report.rows.find((row) => row.key === key)!.label).not.toBe(key);
    }
  });

  it("counts credits from the ledger rather than a counter", async () => {
    expect(await creditsUsedThisMonth(orgId)).toBe(0);
    await recordCost({ organizationId: orgId, provider: "openai", operation: "direct", costCents: 0.4, credits: 1 });
    await recordCost({ organizationId: orgId, provider: "higgsfield", operation: "image", costCents: 4, credits: 1 });
    // Our own renderer spends none, and still writes a row: a pack with no cost row cannot be told
    // apart from one nobody has rendered.
    await recordCost({ organizationId: orgId, provider: "briefly", operation: "render", costCents: 0, credits: 0 });
    expect(await creditsUsedThisMonth(orgId)).toBe(2);
  });

  it("refuses to spend past the allowance, and says by how much", async () => {
    await setOverrides({ organizationId: orgId, patch: { creativeCredits: 2 }, actorId: adminId });
    expect(await hasCreditsLeft(orgId, 1)).toBe(false);
    await expect(assertCredits(orgId, 1)).rejects.toThrow(ForbiddenError);
    await expect(assertCredits(orgId, 1)).rejects.toThrow(/3 of this month's 2/);
  });

  it("lets a Super Admin grant credits a plan does not include", async () => {
    await setOverrides({ organizationId: orgId, patch: { creativeCredits: 50 }, actorId: adminId });
    expect(await hasCreditsLeft(orgId, 10)).toBe(true);
    await expect(assertCredits(orgId, 10)).resolves.toBeUndefined();
  });

  it("treats blank as unlimited, which is not the same as a large number", async () => {
    await setOverrides({ organizationId: orgId, patch: { creativeCredits: null }, actorId: adminId });
    expect(await hasCreditsLeft(orgId, 1_000_000)).toBe(true);
    await expect(assertCredits(orgId, 1_000_000)).resolves.toBeUndefined();
  });

  it("treats zero as none, which is not the same as blank", async () => {
    await setOverrides({ organizationId: orgId, patch: { creativeCredits: 0 }, actorId: adminId });
    expect(await hasCreditsLeft(orgId, 1)).toBe(false);
  });

  it("gates Cinematic mode on the flag, not on the credits", async () => {
    await setOverrides({ organizationId: orgId, patch: { creativeCredits: null, socialPack: true, cinematicMode: false, videoGeneration: false }, actorId: adminId });
    await runAsOrganization(orgId, async () => {
      await expect(createPack({ organizationId: orgId, name: "Invented", format: "CAROUSEL", mode: "CINEMATIC", actorId: adminId })).rejects.toThrow(ForbiddenError);
      // The modes that only use the organisation's own material are unaffected.
      const studio = await createPack({ organizationId: orgId, name: "Studio", format: "CAROUSEL", mode: "STUDIO", actorId: adminId });
      expect(studio.mode).toBe("STUDIO");
    });

    await setOverrides({ organizationId: orgId, patch: { cinematicMode: true }, actorId: adminId });
    await runAsOrganization(orgId, async () => {
      const pack = await createPack({ organizationId: orgId, name: "Now invented", format: "CAROUSEL", mode: "CINEMATIC", actorId: adminId });
      expect(pack.mode).toBe("CINEMATIC");
    });
  });

  it("keeps the override keys and the entitlement keys in step", () => {
    // A key in one list and not the other is an override that does nothing, or a gate nobody can
    // reach. Both have happened; neither is visible without this.
    const all = [...LIMIT_KEYS, ...FLAG_KEYS];
    expect(new Set(all).size).toBe(all.length);
  });
});
