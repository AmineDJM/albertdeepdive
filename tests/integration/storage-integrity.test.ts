import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { getStorage } from "@/server/storage";
import { auditStorage, storageHealth, verifyChecksums } from "@/server/storage/audit";
import { migrateLocalObjectsToBucket } from "@/server/storage/migrate";
import { mediaUrls } from "@/server/media/urls";

/**
 * The third fact.
 *
 * A library row holds a key. A browser asks for that key. Whether the bytes behind it exist is a
 * separate fact from both, and nothing in the product could state it — which is how a deployed
 * newsroom ended up with every thumbnail broken while the database and the console both looked
 * perfectly healthy.
 *
 * These tests reproduce that exact situation against a real database and real storage: take an
 * object out from underneath a row, and check that the audit names it, attributes it to the right
 * workspace, and that a digest check notices when the bytes are wrong rather than absent.
 */
describe("storage integrity", () => {
  let organizationId: string;
  let assetId: string;
  let assetKey: string;

  beforeAll(async () => {
    await ensureSeeded();
    const org = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") });
    organizationId = org!.id;
    const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.organizationId, organizationId) });
    assetId = asset!.id;
    assetKey = asset!.storageKey;
  }, 120_000);

  it("round-trips a health-check object and leaves nothing behind", async () => {
    const health = await storageHealth();
    expect(health.wrote).toBe(true);
    expect(health.read).toBe(true);
    expect(health.signed).toBe(true);
    expect(health.deleted).toBe(true);
    expect(health.ok).toBe(true);
    expect(health.error).toBeNull();
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    // The check writes under its own prefix, which `organizationOwning` does not recognise, so it
    // is never servable to anybody — and it cleans up after itself.
    const storage = await getStorage();
    expect((await storage.list("health/")).length).toBe(0);
  });

  it("finds every object the database expects, on a library nobody has touched", async () => {
    const report = await auditStorage();
    expect(report.expected).toBeGreaterThan(0);
    expect(report.missing).toEqual([]);
    expect(report.byWorkspace).toEqual([]);
  });

  it("names the missing object, and whose it is, when the bytes go away", async () => {
    const storage = await getStorage();
    const original = await storage.get(assetKey);
    expect(original).toBeTruthy();
    await storage.delete(assetKey);
    try {
      const report = await auditStorage();
      const found = report.missing.find((row) => row.key === assetKey);
      expect(found, "the audit must name the key whose bytes are gone").toBeTruthy();
      expect(found!.kind).toBe("original");
      expect(found!.organizationId).toBe(organizationId);
      expect(report.byWorkspace.find((row) => row.organizationId === organizationId)?.missing).toBeGreaterThanOrEqual(1);

      // And this is what the reader sees meanwhile: a URL is still signed for a key with nothing
      // behind it, which is exactly the broken picture in the library.
      const urls = await mediaUrls([assetId], "THUMBNAIL");
      expect(Object.keys(urls)).toContain(assetId);
    } finally {
      await storage.put(assetKey, original!, { contentType: "image/jpeg" });
    }
    expect((await auditStorage()).missing).toEqual([]);
  });

  it("notices bytes that are present but wrong", async () => {
    const storage = await getStorage();
    const original = await storage.get(assetKey);
    const sums = await verifyChecksums(5, organizationId);
    expect(sums.length).toBeGreaterThan(0);
    expect(sums.every((row) => row.ok)).toBe(true);

    await storage.put(assetKey, Buffer.from("not the picture that was ingested"), { contentType: "image/jpeg" });
    try {
      const after = await verifyChecksums(25, organizationId);
      const row = after.find((each) => each.key === assetKey);
      expect(row, "the asset must be in the sample to be judged").toBeTruthy();
      expect(row!.ok).toBe(false);
      expect(row!.actual).not.toBe(row!.expected);
    } finally {
      await storage.put(assetKey, original!, { contentType: "image/jpeg" });
    }
  });

  it("lists as orphans the objects no row points at", async () => {
    const storage = await getStorage();
    const stray = "media/00000000-0000-4000-8000-000000000000/original.jpg";
    await storage.put(stray, Buffer.from("nobody's"), { contentType: "image/jpeg" });
    try {
      const report = await auditStorage();
      expect(report.orphans).toContain(stray);
      // Listed, never deleted: an audit that also tidies is an audit you cannot run twice.
      expect(await storage.exists(stray)).toBe(true);
    } finally {
      await storage.delete(stray);
    }
  });

  it("refuses to migrate into a bucket that is not connected", async () => {
    // The test install writes to disk. "Copy the disk into the bucket" with no bucket would be a
    // migration that copies a disk onto itself and reports success.
    await expect(migrateLocalObjectsToBucket({ dryRun: true })).rejects.toThrow(/not connected/i);
  });
});
