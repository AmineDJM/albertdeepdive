import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import sharp from "sharp";
import { ensureSeeded } from "../helpers/db";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { getMediaDetail, listMedia, listStoriesForPicker, mediaStats, recommendMediaForStory } from "@/server/media/library";
import { attachToStory, bulkSetRights, clearDuplicate, detachFromStory, markDuplicate, setCrop, setRightsStatus, setStoryMediaRole, updateMediaMetadata, type MediaActor } from "@/server/media/rights";
import { recheckDuplicates } from "@/server/media/jobs";
import type { SeedResult } from "@/server/db/seed";

let seed: SeedResult;
let admin: MediaActor;
let campusEditor: MediaActor;

async function actorByRole(role: "SUPER_ADMIN" | "CAMPUS_EDITOR"): Promise<MediaActor> {
  const user = await db.query.users.findFirst({ where: eq(s.users.role, role) });
  if (!user) throw new Error(`No seeded user with role ${role}`);
  return { id: user.id, role: user.role };
}

beforeAll(async () => {
  seed = await ensureSeeded();
  admin = await actorByRole("SUPER_ADMIN");
  campusEditor = await actorByRole("CAMPUS_EDITOR");
});

describe("listMedia", () => {
  it("returns the seeded assets with signed URLs, story links, provenance and facets", async () => {
    const res = await listMedia(seed.editionId, { pageSize: 10 });
    expect(res.total).toBeGreaterThanOrEqual(50);
    expect(res.rows).toHaveLength(10);
    expect(res.pageCount).toBe(Math.ceil(res.total / 10));
    for (const row of res.rows) {
      expect(row.thumbUrl).toMatch(/\/api\/storage\/media\/.*thumbnail\.webp\?/);
      expect(row.thumbUrl).toContain("sig=");
      expect(row.webUrl).toMatch(/web\.webp/);
      expect(row.isArchived).toBe(false);
    }
    const full = await listMedia(seed.editionId, { pageSize: 200 });
    expect(full.rows.some((r) => r.stories.length > 0)).toBe(true);
    expect(full.rows.some((r) => r.contributorName)).toBe(true);
    expect(full.rows.some((r) => r.submissionTitle)).toBe(true);
    expect(res.facets.rights.GREEN + res.facets.rights.YELLOW + res.facets.rights.RED).toBe(res.total);
    expect(Object.values(res.facets.kind).reduce((a, b) => a + b, 0)).toBe(res.total);
  });

  it("filters by rights, kind, quality, text, story and usage", async () => {
    const yellow = await listMedia(seed.editionId, { rights: "YELLOW", pageSize: 200 });
    expect(yellow.total).toBeGreaterThan(0);
    expect(yellow.rows.every((r) => r.rightsStatus === "YELLOW")).toBe(true);

    const logos = await listMedia(seed.editionId, { kind: "logo", pageSize: 200 });
    expect(logos.total).toBeGreaterThan(0);
    expect(logos.rows.every((r) => r.kind === "logo")).toBe(true);

    const low = await listMedia(seed.editionId, { quality: "low", pageSize: 200 });
    expect(low.total).toBeGreaterThan(0);
    expect(low.rows.every((r) => (r.qualityScore ?? 0) < 60)).toBe(true);
    const ok = await listMedia(seed.editionId, { quality: "ok", pageSize: 200 });
    expect(ok.total + low.total).toBe(yellow.total + (await listMedia(seed.editionId, { rights: "GREEN", pageSize: 200 })).total + (await listMedia(seed.editionId, { rights: "RED", pageSize: 200 })).total);

    const search = await listMedia(seed.editionId, { q: "carrefour", pageSize: 200 });
    expect(search.total).toBeGreaterThan(0);
    expect(search.rows.every((r) => `${r.fileName} ${r.caption ?? ""} ${r.aiDescription ?? ""} ${r.credit ?? ""}`.toLowerCase().includes("carrefour"))).toBe(true);

    const withStory = (await listMedia(seed.editionId, { pageSize: 200 })).rows.find((r) => r.stories.length > 0)!;
    const byStory = await listMedia(seed.editionId, { storyId: withStory.stories[0].id, pageSize: 200 });
    expect(byStory.rows.some((r) => r.id === withStory.id)).toBe(true);
    expect(byStory.rows.every((r) => r.stories.some((st) => st.id === withStory.stories[0].id))).toBe(true);

    const unused = await listMedia(seed.editionId, { unused: "true", pageSize: 200 });
    expect(unused.rows.every((r) => r.stories.length === 0)).toBe(true);

    const none = await listMedia(seed.editionId, { q: "zzz-nothing-matches-zzz" });
    expect(none.total).toBe(0);
    expect(none.rows).toEqual([]);
  });

  it("sorts and paginates", async () => {
    const byQuality = await listMedia(seed.editionId, { sort: "quality", pageSize: 200 });
    const scores = byQuality.rows.map((r) => r.qualityScore ?? -1);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const bySize = await listMedia(seed.editionId, { sort: "size", pageSize: 5 });
    expect(bySize.rows[0].sizeBytes).toBeGreaterThanOrEqual(bySize.rows[4].sizeBytes);
    const p1 = await listMedia(seed.editionId, { pageSize: 20, page: 1 });
    const p2 = await listMedia(seed.editionId, { pageSize: 20, page: "2" });
    expect(p2.page).toBe(2);
    expect(p1.rows.map((r) => r.id).some((id) => p2.rows.map((r) => r.id).includes(id))).toBe(false);
  });

  it("scopes to every edition when editionId is null", async () => {
    const all = await listMedia(null, { pageSize: 1 });
    expect(all.total).toBeGreaterThanOrEqual((await listMedia(seed.editionId, { pageSize: 1 })).total);
  });
});

describe("mediaStats and getMediaDetail", () => {
  it("counts totals, rights, low quality and print-ready assets", async () => {
    const stats = await mediaStats(seed.editionId);
    const list = await listMedia(seed.editionId, { pageSize: 200 });
    expect(stats.total).toBe(list.total);
    expect(stats.byRights).toEqual(list.facets.rights);
    expect(stats.lowQuality).toBe(list.rows.filter((r) => (r.qualityScore ?? 0) < 60).length);
    expect(stats.printReady).toBe(list.rows.filter((r) => (r.width ?? 0) >= 1400 && r.rightsStatus === "GREEN").length);
    expect(stats.unused).toBe((await listMedia(seed.editionId, { unused: "true", pageSize: 200 })).total);
  });

  it("returns variants with URLs, provenance, consents, similar assets and the audit trail", async () => {
    const row = (await listMedia(seed.editionId, { pageSize: 200 })).rows.find((r) => r.submissionId && r.stories.length)!;
    const detail = await getMediaDetail(row.id);
    expect(detail.asset.id).toBe(row.id);
    expect("storageKey" in detail.asset).toBe(false);
    expect(detail.variants.map((v) => v.kind).sort()).toEqual(["PRINT", "THUMBNAIL", "WEB"]);
    for (const v of detail.variants) {
      expect(v.url).toContain("/api/storage/");
      expect(v.downloadUrl).toContain("download=");
    }
    expect(detail.originalDownloadUrl).toContain(encodeURIComponent(row.fileName).replace(/%20/g, "+").slice(0, 8));
    expect(detail.edition?.id).toBe(seed.editionId);
    expect(detail.submission?.id).toBe(row.submissionId);
    expect(detail.contributor?.name).toBe(row.contributorName);
    expect(detail.stories.map((st) => st.id)).toEqual(row.stories.map((st) => st.id));
    expect(detail.consents.some((c) => c.type === "IMAGE_RIGHTS" && c.text)).toBe(true);
    expect(Array.isArray(detail.similar)).toBe(true);
    expect(Array.isArray(detail.audit)).toBe(true);
    await expect(getMediaDetail("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/i);
  });
});

describe("rights", () => {
  it("setRightsStatus RED then bulkSetRights GREEN record decisions and audit rows", async () => {
    const [a, b] = (await listMedia(seed.editionId, { rights: "GREEN", pageSize: 2 })).rows;
    const red = await setRightsStatus(a.id, "RED", "Person pictured did not consent", admin);
    expect(red.rightsStatus).toBe("RED");
    expect(red.rightsNote).toBe("Person pictured did not consent");

    const decisions = await db.query.editorialDecisions.findMany({ where: and(eq(s.editorialDecisions.entityType, "MEDIA"), eq(s.editorialDecisions.entityId, a.id)), orderBy: [desc(s.editorialDecisions.createdAt)] });
    expect(decisions[0].decision).toBe("RIGHTS_RED");
    expect(decisions[0].userId).toBe(admin.id);
    expect((decisions[0].previousValue as { rightsStatus: string }).rightsStatus).toBe("GREEN");
    expect(decisions[0].editionId).toBe(seed.editionId);

    const detailRed = await getMediaDetail(a.id);
    expect(detailRed.audit.some((e) => e.action === "decision.rights_red")).toBe(true);

    const result = await bulkSetRights([a.id, b.id, a.id], "GREEN", "Confirmed by email on 12 May", admin);
    expect(result).toEqual({ updated: 2, failed: [] });
    for (const id of [a.id, b.id]) {
      const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, id) });
      expect(asset?.rightsStatus).toBe("GREEN");
      expect(asset?.rightsNote).toBe("Confirmed by email on 12 May");
      const audit = await db.query.auditLog.findMany({ where: and(eq(s.auditLog.entityType, "MEDIA"), eq(s.auditLog.entityId, id)) });
      expect(audit.some((e) => e.action === "decision.rights_green" && e.userId === admin.id)).toBe(true);
    }
    // An empty note keeps the previous one; an explicit "" clears it.
    await setRightsStatus(a.id, "YELLOW", undefined, admin);
    expect((await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, a.id) }))?.rightsNote).toBe("Confirmed by email on 12 May");
    await setRightsStatus(a.id, "GREEN", "", admin);
    expect((await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, a.id) }))?.rightsNote).toBeNull();
  });

  it("requires the media:rights permission", async () => {
    const [a] = (await listMedia(seed.editionId, { pageSize: 1 })).rows;
    await expect(setRightsStatus(a.id, "RED", null, campusEditor)).rejects.toThrow(/media:rights/);
    await expect(bulkSetRights([a.id], "GREEN", null, campusEditor)).rejects.toThrow(/media:rights/);
    await expect(bulkSetRights([], "GREEN", null, admin)).rejects.toThrow(/at least one/);
  });

  it("updates caption, credit and kind with an audit entry", async () => {
    const [a] = (await listMedia(seed.editionId, { pageSize: 1, sort: "name" })).rows;
    const updated = await updateMediaMetadata(a.id, { caption: "  A new caption  ", credit: "© Test", kind: "screenshot" }, admin);
    expect(updated.caption).toBe("A new caption");
    expect(updated.credit).toBe("© Test");
    expect(updated.kind).toBe("screenshot");
    expect((updated.metadata as { kindSetByUser?: boolean }).kindSetByUser).toBe(true);
    const audit = await db.query.auditLog.findMany({ where: and(eq(s.auditLog.entityType, "MEDIA"), eq(s.auditLog.entityId, a.id), eq(s.auditLog.action, "media.update")) });
    expect(audit.length).toBeGreaterThan(0);
    expect((audit.at(-1)!.metadata as { fields: string[] }).fields.sort()).toEqual(["caption", "credit", "kind"]);
    await expect(updateMediaMetadata(a.id, { kind: "video" as never }, admin)).rejects.toThrow();
  });
});

describe("setCrop", () => {
  it("creates a CROP variant file from the original and replaces it on the next call", async () => {
    const photo = (await listMedia(seed.editionId, { kind: "photo", sort: "size", pageSize: 1 })).rows[0];
    const asset = (await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, photo.id) }))!;
    const hero = asset.suggestedCrops.find((c) => c.name === "hero")!;
    const { variant, url } = await setCrop(asset.id, hero, admin);
    expect(variant.kind).toBe("CROP");
    expect(variant.width).toBe(hero.width);
    expect(variant.height).toBe(hero.height);
    expect(variant.cropSpec).toMatchObject({ name: "hero", aspect: "3:2" });
    expect(url).toContain("/api/storage/media/");
    const storage = getStorage();
    expect(await storage.exists(variant.storageKey)).toBe(true);
    const meta = await sharp((await storage.get(variant.storageKey))!).metadata();
    expect(meta.width).toBe(hero.width);
    expect(meta.height).toBe(hero.height);

    const square = asset.suggestedCrops.find((c) => c.name === "square")!;
    const second = await setCrop(asset.id, { ...square, aspect: undefined }, admin);
    expect(second.variant.cropSpec?.aspect).toBe("1:1");
    const crops = await db.query.mediaVariants.findMany({ where: and(eq(s.mediaVariants.assetId, asset.id), eq(s.mediaVariants.kind, "CROP")) });
    expect(crops).toHaveLength(1);
    expect(crops[0].cropSpec?.name).toBe("square");
    const detail = await getMediaDetail(asset.id);
    expect(detail.variants.find((v) => v.kind === "CROP")?.cropSpec?.name).toBe("square");

    await expect(setCrop(asset.id, { name: "bad", x: 10, y: 10, width: asset.width!, height: 100 }, admin)).rejects.toThrow(/bounds/);
    await expect(setCrop(asset.id, hero, campusEditor)).resolves.toBeTruthy(); // campus editors manage media
  });
});

describe("story links", () => {
  it("attaches, re-roles, demotes the previous hero and detaches", async () => {
    const stories = await listStoriesForPicker(seed.editionId);
    const story = stories.find((st) => st.mediaCount > 0)!;
    const existingHero = await db.query.storyMedia.findFirst({ where: and(eq(s.storyMedia.storyId, story.id), eq(s.storyMedia.role, "hero")) });
    // Every seeded asset already belongs to a story, so take a cleared one that is not on this story.
    const candidate = (await listMedia(seed.editionId, { rights: "GREEN", pageSize: 200 })).rows.find((row) => !row.stories.some((st) => st.id === story.id))!;
    expect(candidate).toBeTruthy();

    const link = await attachToStory(candidate.id, story.id, "hero", admin);
    expect(link.role).toBe("hero");
    if (existingHero) {
      const demoted = await db.query.storyMedia.findFirst({ where: and(eq(s.storyMedia.storyId, story.id), eq(s.storyMedia.mediaAssetId, existingHero.mediaAssetId)) });
      expect(demoted?.role).toBe("gallery");
    }
    const again = await attachToStory(candidate.id, story.id, "gallery", admin);
    expect(again.role).toBe("gallery");
    const reRoled = await setStoryMediaRole(candidate.id, story.id, "portrait", admin);
    expect(reRoled.role).toBe("portrait");
    expect((await getMediaDetail(candidate.id)).stories.some((st) => st.id === story.id && st.role === "portrait")).toBe(true);

    await detachFromStory(candidate.id, story.id, admin);
    expect((await getMediaDetail(candidate.id)).stories.some((st) => st.id === story.id)).toBe(false);
    await expect(detachFromStory(candidate.id, story.id, admin)).rejects.toThrow(/not found/i);

    await setRightsStatus(candidate.id, "RED", "blocked for the test", admin);
    await expect(attachToStory(candidate.id, story.id, "gallery", admin)).rejects.toThrow(/blocked/i);
    await setRightsStatus(candidate.id, "GREEN", null, admin);
    if (existingHero) await setStoryMediaRole(existingHero.mediaAssetId, story.id, "hero", admin);
  });
});

describe("duplicates", () => {
  it("marks and clears a duplicate, and the re-check respects the manual decision", async () => {
    const [a, b] = (await listMedia(seed.editionId, { kind: "photo", pageSize: 2, sort: "name" })).rows;
    const marked = await markDuplicate(a.id, b.id, admin);
    expect(marked.duplicateOfId).toBe(b.id);
    expect(marked.similarityGroup).toBe(b.id);
    expect(marked.qualityFlags).toContain("NEAR_DUPLICATE");
    expect((await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, b.id) }))?.similarityGroup).toBe(b.id);
    const detail = await getMediaDetail(a.id);
    expect(detail.duplicateOf?.id).toBe(b.id);
    expect(detail.similar.some((x) => x.id === b.id)).toBe(true);
    expect((await listMedia(seed.editionId, { duplicates: "only", pageSize: 200 })).rows.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));

    const cleared = await clearDuplicate(a.id, admin);
    expect(cleared.duplicateOfId).toBeNull();
    expect(cleared.qualityFlags).not.toContain("NEAR_DUPLICATE");
    const recheck = await recheckDuplicates(a.id);
    expect(recheck.respectedManualDecision).toBe(true);
    expect(recheck.duplicateOfId).toBeNull();
    await expect(markDuplicate(a.id, a.id, admin)).rejects.toThrow(/itself/);
  });
});

describe("recommendMediaForStory", () => {
  it("ranks the story's own submission photos first, never RED, with reasons", async () => {
    const story = await db.query.stories.findFirst({ where: and(eq(s.stories.editionId, seed.editionId), eq(s.stories.title, "Eramet – B1 Marseille")) });
    expect(story).toBeTruthy();
    const members = await db.query.storyClusterMembers.findMany({ where: eq(s.storyClusterMembers.clusterId, story!.clusterId!) });
    const submissionIds = new Set(members.map((m) => m.submissionId));
    expect(submissionIds.size).toBeGreaterThan(0);

    const recs = await recommendMediaForStory(story!.id, { includeAttached: true });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(12);
    expect(recs[0].submissionId && submissionIds.has(recs[0].submissionId)).toBe(true);
    expect(recs[0].reasons[0]).toMatch(/^Sent with/);
    expect(recs.every((r) => r.rightsStatus !== "RED")).toBe(true);
    expect(recs.every((r) => r.thumbUrl && r.webUrl)).toBe(true);
    const scores = recs.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const own = recs.filter((r) => r.submissionId && submissionIds.has(r.submissionId));
    const others = recs.filter((r) => !(r.submissionId && submissionIds.has(r.submissionId)));
    if (own.length && others.length) expect(Math.min(...own.map((r) => r.score))).toBeGreaterThan(Math.max(...others.map((r) => r.score)));

    const fresh = await recommendMediaForStory(story!.id);
    const attached = await db.query.storyMedia.findMany({ where: eq(s.storyMedia.storyId, story!.id) });
    expect(fresh.every((r) => !attached.some((l) => l.mediaAssetId === r.id))).toBe(true);
    await expect(recommendMediaForStory("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/not found/i);
  });
});
