import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { getStorage } from "@/server/storage";
import { bulkDelete, deleteMedia } from "@/server/media/rights";
import { runAsOrganization } from "@/server/tenancy/context";
import { createOrganization } from "@/server/tenancy/service";

/**
 * Deleting a picture from the library, for real.
 *
 * The library offered "Archive", which hides, and a selection button that read "Effacer" in French
 * and only deselected. What is checked here is that delete removes the row, every size of the
 * picture and its files in storage, that everything pointing at it lets go (story, article block,
 * page, cover, logo), and that another workspace's picture cannot be deleted by id.
 */
describe("deleting a picture", () => {
  let orgId: string;
  let admin: { id: string; role: (typeof s.users.$inferSelect)["role"] };

  beforeAll(async () => {
    await ensureSeeded();
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    const user = (await db.query.users.findFirst({ where: eq(s.users.email, "admin@albertschool.com") }))!;
    admin = { id: user.id, role: user.role };
  });

  /** A picture of the workspace, with real files behind it and a variant. */
  async function pictureWithFiles(label: string) {
    const storage = await getStorage();
    const original = `test/delete/${label}-${Date.now()}.jpg`;
    const web = `test/delete/${label}-${Date.now()}-web.jpg`;
    await storage.put(original, Buffer.from("original"), { contentType: "image/jpeg" });
    await storage.put(web, Buffer.from("web"), { contentType: "image/jpeg" });
    const [asset] = await db
      .insert(s.mediaAssets)
      .values({ organizationId: orgId, storageKey: original, fileName: `${label}.jpg`, mimeType: "image/jpeg", sizeBytes: 8, width: 1200, height: 800 })
      .returning();
    await db.insert(s.mediaVariants).values({ assetId: asset.id, kind: "WEB", storageKey: web, width: 1200, height: 800, sizeBytes: 3, format: "jpeg" });
    return { asset, keys: [original, web] };
  }

  it("removes the row, every size, the files, and every pointer to it", async () => {
    const { asset, keys } = await pictureWithFiles("used");
    const article = (await db.query.articles.findFirst())!;
    const story = (await db.query.stories.findFirst({ where: eq(s.stories.id, article.storyId) }))!;
    const edition = (await db.query.editions.findFirst({ where: eq(s.editions.id, story.editionId) }))!;
    const page = await db.query.pagePlanPages.findFirst();

    await db.insert(s.storyMedia).values({ storyId: story.id, mediaAssetId: asset.id });
    const before = article.body.length;
    await db.update(s.articles).set({ body: [...article.body, { id: "img-delete", type: "image", assetId: asset.id }] }).where(eq(s.articles.id, article.id));
    await db.update(s.editions).set({ coverMediaAssetId: asset.id }).where(eq(s.editions.id, edition.id));
    await db.update(s.organizations).set({ logoMediaId: asset.id }).where(eq(s.organizations.id, orgId));
    if (page) await db.update(s.pagePlanPages).set({ mediaAssetIds: [...page.mediaAssetIds, asset.id] }).where(eq(s.pagePlanPages.id, page.id));

    const storage = await getStorage();
    for (const key of keys) expect(await storage.exists(key)).toBe(true);

    const result = await runAsOrganization(orgId, () => deleteMedia(asset.id, admin));
    expect(result).toMatchObject({ id: asset.id, files: 2 });

    expect(await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, asset.id) })).toBeUndefined();
    expect(await db.query.mediaVariants.findFirst({ where: eq(s.mediaVariants.assetId, asset.id) })).toBeUndefined();
    expect(await db.query.storyMedia.findFirst({ where: and(eq(s.storyMedia.storyId, story.id), eq(s.storyMedia.mediaAssetId, asset.id)) })).toBeUndefined();
    for (const key of keys) expect(await storage.exists(key)).toBe(false);

    const after = (await db.query.articles.findFirst({ where: eq(s.articles.id, article.id) }))!;
    expect(after.body).toHaveLength(before);
    expect(after.body.some((block) => block.type === "image" && block.assetId === asset.id)).toBe(false);
    expect((await db.query.editions.findFirst({ where: eq(s.editions.id, edition.id) }))?.coverMediaAssetId).toBeNull();
    expect((await db.query.organizations.findFirst({ where: eq(s.organizations.id, orgId) }))?.logoMediaId).toBeNull();
    if (page) expect((await db.query.pagePlanPages.findFirst({ where: eq(s.pagePlanPages.id, page.id) }))?.mediaAssetIds).not.toContain(asset.id);

    const [trail] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.action, "media.delete"), eq(s.auditLog.entityId, asset.id)));
    expect(trail).toBeTruthy();
  });

  it("deletes a whole selection", async () => {
    const a = await pictureWithFiles("first");
    const b = await pictureWithFiles("second");
    expect(await runAsOrganization(orgId, () => bulkDelete([a.asset.id, b.asset.id, a.asset.id], admin))).toEqual({ deleted: 2, failed: 0 });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.mediaAssets).where(sql`${s.mediaAssets.id} in (${a.asset.id}, ${b.asset.id})`);
    expect(n).toBe(0);
  });

  it("will not delete another workspace's picture, even by its id", async () => {
    const { asset, keys } = await pictureWithFiles("theirs");
    const other = await createOrganization({ name: "Somebody Else", type: "COMPANY", locale: "en", timezone: "Europe/Paris" }, admin.id);
    await expect(runAsOrganization(other.id, () => deleteMedia(asset.id, admin))).rejects.toThrow(/not found/i);
    expect(await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, asset.id) })).toBeTruthy();
    expect(await (await getStorage()).exists(keys[0])).toBe(true);
  });

  it("is refused to someone who may not manage media", async () => {
    const { asset } = await pictureWithFiles("guarded");
    await expect(runAsOrganization(orgId, () => deleteMedia(asset.id, { id: admin.id, role: "VIEWER" }))).rejects.toThrow(/permission/i);
  });
});
