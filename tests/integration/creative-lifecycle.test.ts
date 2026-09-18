import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPack, deletePack, getPack, setBrief } from "@/server/creative/service";
import { getStorage } from "@/server/storage";
import { ensureDefaultPlans } from "@/server/billing/plans";
import { setOverrides } from "@/server/platform/overrides";
import type { CreativeBrief } from "@/lib/creative/brief";

/**
 * What happens to the files.
 *
 * Every one of these was a leak or a dead end found by asking "and then what is left behind?" —
 * which nothing in the render path had ever been asked, because the render path only ever adds.
 */
describe("a pack's files", () => {
  let adminId: string;
  let orgId: string;

  const briefFor = (frames: number): CreativeBrief => ({
    format: "CAROUSEL",
    mode: "STUDIO",
    intent: "Show the work.",
    frames: Array.from({ length: frames }, (_, index) => ({
      layout: index === frames - 1 ? ("cta" as const) : ("statement" as const),
      headline: `Slide number ${index + 1}`,
      surface: index === 0 ? ("brand" as const) : index === frames - 1 ? ("accent" as const) : ("paper" as const),
      emphasis: "normal" as const,
    })),
    caption: "A caption that says something.",
    hashtags: [],
  });

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    const admin = await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") });
    adminId = admin!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    await setOverrides({ organizationId: orgId, patch: { socialPack: true, creativeCredits: null }, actorId: adminId });
  });

  /** Stand in for a render: attach a real stored file to every pending frame. */
  async function pretendRendered(packId: string) {
    const pack = await getPack(packId);
    const storage = getStorage();
    for (const asset of pack.assets.filter((a) => a.kind === "FRAME")) {
      const key = `creative/${packId}/frame-${String(asset.index + 1).padStart(2, "0")}.jpg`;
      await storage.put(key, Buffer.from(`frame ${asset.index}`), { contentType: "image/jpeg" });
      await db.update(s.creativeAssets).set({ status: "READY", storageKey: key }).where(eq(s.creativeAssets.id, asset.id));
    }
    return (await getPack(packId)).assets.map((a) => a.storageKey).filter((k): k is string => Boolean(k));
  }

  it("go with the pack when it is deleted", async () => {
    await runAsOrganization(orgId, async () => {
      const pack = await createPack({ organizationId: orgId, name: "Doomed", format: "CAROUSEL", mode: "STUDIO", actorId: adminId });
      await setBrief({ packId: pack.id, brief: briefFor(4), actorId: adminId });
      const keys = await pretendRendered(pack.id);
      expect(keys.length).toBe(4);

      const storage = getStorage();
      for (const key of keys) expect(await storage.exists(key), key).toBe(true);

      await deletePack(pack.id, adminId);

      // The rows go by cascade and nothing else was ever going to remove the files.
      for (const key of keys) expect(await storage.exists(key), key).toBe(false);
    });
  });

  it("do not go with somebody else's pack: a shared generated ground survives", async () => {
    await runAsOrganization(orgId, async () => {
      const storage = getStorage();
      const shared = "creative/generated/deadbeefdeadbeefdeadbeefdeadbeef.jpg";
      await storage.put(shared, Buffer.from("a ground two packs use"), { contentType: "image/jpeg" });

      const pack = await createPack({ organizationId: orgId, name: "Shares a ground", format: "CAROUSEL", mode: "STUDIO", actorId: adminId });
      await setBrief({ packId: pack.id, brief: briefFor(3), actorId: adminId });
      await pretendRendered(pack.id);
      await deletePack(pack.id, adminId);

      // Content-addressed and shared. Deleting it with whichever pack happened to be first would
      // blank a frame in another one.
      expect(await storage.exists(shared)).toBe(true);
      await storage.delete(shared);
    });
  });

  it("shrink when a re-direct produces fewer slides", async () => {
    await runAsOrganization(orgId, async () => {
      const pack = await createPack({ organizationId: orgId, name: "Shrinks", format: "CAROUSEL", mode: "STUDIO", actorId: adminId });
      await setBrief({ packId: pack.id, brief: briefFor(6), actorId: adminId });
      const before = await pretendRendered(pack.id);
      expect(before.length).toBe(6);

      await setBrief({ packId: pack.id, brief: briefFor(3), actorId: adminId });

      const after = await getPack(pack.id);
      expect(after.assets.filter((a) => a.kind === "FRAME")).toHaveLength(3);

      const storage = getStorage();
      // The rows for 4, 5 and 6 are gone; so are their files.
      for (const key of before.slice(3)) expect(await storage.exists(key), key).toBe(false);
      // And the ones still in the spec are untouched.
      for (const key of before.slice(0, 3)) expect(await storage.exists(key), key).toBe(true);

      await deletePack(pack.id, adminId);
    });
  });
});

/**
 * The recovery path, which is the one nobody tests and everybody uses.
 *
 * A Reel rendered on a host without an encoder has its frames and no video. When the encoder arrives
 * the obvious thing to do is press Render again — and for a while that did nothing at all, because
 * "already rendered" counted frames and a Reel's frames were all there.
 */
describe("a Reel whose encode was skipped", () => {
  let adminId: string;
  let orgId: string;
  let editionId: string;

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    editionId = (await db.query.editions.findFirst({ where: eq(s.editions.organizationId, orgId) }))!.id;
    await setOverrides({ organizationId: orgId, patch: { socialPack: true, videoGeneration: true, creativeCredits: null }, actorId: adminId });
  });

  it("encodes when asked again, and only then settles", async () => {
    const { generatePack } = await import("@/server/creative/service");
    const { getJobHandler } = await import("@/server/jobs/registry");
    await import("@/server/jobs/handlers");

    await runAsOrganization(orgId, async () => {
      const pack = await createPack({ organizationId: orgId, name: "Recovers", format: "REEL", mode: "STUDIO", editionId, actorId: adminId });
      await generatePack({ packId: pack.id, actorId: adminId });
      const job = (await db.query.jobs.findFirst({ where: eq(s.jobs.type, "creative.render"), orderBy: (t, { desc }) => [desc(t.createdAt)] }))!;
      const handler = getJobHandler("creative.render")!;
      const run = () => handler(job.payload as Record<string, unknown>, { job, workerId: "test", progress: async () => {}, log: () => {} }) as Promise<{ frames: number; skipped: boolean }>;

      const original = process.env.FFMPEG_PATH;
      try {
        process.env.FFMPEG_PATH = "/nonexistent/ffmpeg";
        await run();
        let after = await getPack(pack.id);
        expect(after.assets.some((asset) => asset.kind === "VIDEO")).toBe(false);
        expect(after.assets.filter((asset) => asset.kind === "FRAME" && asset.status === "READY").length).toBeGreaterThan(0);

        // The encoder arrives.
        delete process.env.FFMPEG_PATH;
        const second = await run();
        expect(second.skipped, "asking again with an encoder present must not be a no-op").toBe(false);
        after = await getPack(pack.id);
        const video = after.assets.find((asset) => asset.kind === "VIDEO");
        expect(video?.status).toBe("READY");
        expect(Number(video?.sizeBytes ?? 0)).toBeGreaterThan(1000);
        expect(Number(video?.durationSeconds ?? 0)).toBeGreaterThan(1);

        // And now there really is nothing to do.
        expect((await run()).skipped).toBe(true);
      } finally {
        if (original) process.env.FFMPEG_PATH = original;
        else delete process.env.FFMPEG_PATH;
      }

      await deletePack(pack.id, adminId);
    });
  }, 120_000);
});
