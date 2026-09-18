import { beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { ensureDefaultPlans } from "@/server/billing/plans";
import { setOverrides } from "@/server/platform/overrides";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPack, deletePack, GENERATED_PREFIX, pruneGeneratedGrounds } from "@/server/creative/service";
import { getStorage } from "@/server/storage";

/**
 * The file with no owner.
 *
 * A generated ground is shared between packs, so no pack's deletion removes it, and until this
 * existed nothing did. Three grounds: one nobody names and nobody has touched for days, one nobody
 * names but written a moment ago, one a pack's spec names. Only the first may go.
 */
describe("pruning generated grounds", () => {
  const storage = getStorage();
  const hex = () => crypto.randomUUID().replace(/-/g, "");
  const orphan = `${GENERATED_PREFIX}${hex()}.jpg`;
  const fresh = `${GENERATED_PREFIX}${hex()}.jpg`;
  const namedKey = hex();
  const named = `${GENERATED_PREFIX}${namedKey}.jpg`;
  let adminId: string;
  let orgId: string;
  let packId: string;

  const age = async (key: string, hours: number) => {
    const when = new Date(Date.now() - hours * 3_600_000);
    await fs.utimes(storage.localPath!(key), when, when);
  };

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    await setOverrides({ organizationId: orgId, patch: { socialPack: true, creativeCredits: null }, actorId: adminId });

    for (const key of [orphan, fresh, named]) await storage.put(key, Buffer.from("a ground"), { contentType: "image/jpeg" });
    await age(orphan, 72);
    await age(named, 72);

    await runAsOrganization(orgId, async () => {
      packId = (await createPack({ organizationId: orgId, name: "Names a ground", format: "CAROUSEL", mode: "STUDIO", actorId: adminId })).id;
      // Only the reference matters to the prune; the rest of a spec is not its concern.
      await db
        .update(s.creativePacks)
        .set({ spec: { frames: [{ image: { generate: { key: namedKey } } }] } as never })
        .where(eq(s.creativePacks.id, packId));
    });
  });

  it("says what would go, and touches nothing", async () => {
    const dry = await pruneGeneratedGrounds({ dryRun: true });
    expect(dry.removed).toContain(orphan);
    expect(dry.removed).not.toContain(fresh);
    expect(dry.removed).not.toContain(named);
    expect(dry.referenced).toBeGreaterThanOrEqual(1);
    expect(await storage.exists(orphan)).toBe(true);
  });

  it("removes the orphan and keeps the named one and the one just written", async () => {
    const result = await pruneGeneratedGrounds();
    expect(result.removed).toContain(orphan);
    expect(await storage.exists(orphan)).toBe(false);
    expect(await storage.exists(named)).toBe(true);
    expect(await storage.exists(fresh)).toBe(true);
  });

  it("lets a ground go once the last pack naming it is gone", async () => {
    await runAsOrganization(orgId, () => deletePack(packId, adminId));
    expect((await pruneGeneratedGrounds({ dryRun: true })).removed).toContain(named);
    await storage.delete(named);
    await storage.delete(fresh);
  });
});
