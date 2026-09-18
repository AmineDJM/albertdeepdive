import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { FakeImageProvider } from "../helpers/fake-images";
import { ensureDefaultPlans } from "@/server/billing/plans";
import { setOverrides } from "@/server/platform/overrides";
import { runAsOrganization } from "@/server/tenancy/context";
import { setImageProvidersForTests } from "@/server/images/providers";
import { getVersion, lineage, modelStats, pendingVersions, rejectVersion, requestEdit, requestImage, rootForAsset, setCurrentVersion } from "@/server/images/service";
import { maskFor, runImageVersion, subjectOf } from "@/server/images/jobs";
import { lineViewForMedia, pendingViews, referenceCandidates } from "@/server/images/views";
import { ingestMedia } from "@/server/media/ingest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { REGENERATE_AFTER } from "@/lib/images/plan";

/**
 * A picture, asked for, made, changed, kept.
 *
 * Against a provider that draws rather than asks anyone: a generation lands in the library with
 * its provenance; an edit is a new version of a line whose original is never touched; a lazy
 * answer is caught and asked for again; the fourth change to a protected subject starts again
 * from the master; restore and reject move the line's current marker and nothing else; and none
 * of it crosses a workspace's wall.
 */
describe("the picture engine", () => {
  const fake = new FakeImageProvider();
  let orgId: string;
  let otherOrgId: string;
  let adminId: string;
  let editionId: string;
  let photoId: string;

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    setImageProvidersForTests({ openai: fake });
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    editionId = (await db.query.editions.findFirst({ where: eq(s.editions.organizationId, orgId) }))!.id;
    await setOverrides({ organizationId: orgId, patch: { creativeCredits: null }, actorId: adminId });
    const [other] = await db
      .insert(s.organizations)
      .values({ name: "Elsewhere Institute", slug: `elsewhere-${Date.now()}`, locale: "en" } as never)
      .returning();
    otherOrgId = other.id;

    // A photograph of a person, as the library would know it after description.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="100%" height="100%" fill="#8fb3d9"/><circle cx="600" cy="330" r="150" fill="#e0b090"/><rect x="450" y="480" width="300" height="320" fill="#2b3a55"/><rect x="60" y="600" width="140" height="180" fill="#6c8a45"/></svg>`;
    const photo = await sharp(Buffer.from(svg)).png().toBuffer();
    const ingested = await runAsOrganization(orgId, () => ingestMedia({ buffer: photo, fileName: "founder-portrait.png", mimeType: "image/png", editionId, userId: adminId, caption: "Nadia Chevalier, founder", altText: "Nadia Chevalier standing in front of the campus, a plant on the left", rightsStatus: "GREEN", kind: "photo", skipDuplicateCheck: true }));
    photoId = ingested.asset.id;
    await db.update(s.mediaAssets).set({ aiDescription: "A founder standing outdoors, a plant on the left.", aiTags: ["portrait", "founder", "outdoors"] }).where(eq(s.mediaAssets.id, photoId));
  });

  afterAll(async () => {
    setImageProvidersForTests(null);
    await db.delete(s.organizations).where(eq(s.organizations.id, otherOrgId));
  });

  it("knows a person when it sees one described", async () => {
    const asset = (await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, photoId) }))!;
    expect(subjectOf([asset])).toMatchObject({ people: true, logo: false });
  });

  it("makes a picture from a sentence and files it with its provenance", async () => {
    const row = await requestImage({ organizationId: orgId, editionId, instruction: "A warm photograph of the campus terrace at dusk", actorId: adminId });
    expect(row.status).toBe("QUEUED");
    expect(row.version).toBe(1);
    expect(await pendingVersions(orgId, editionId)).toBeGreaterThanOrEqual(1);

    const result = await runImageVersion({ versionId: row.id });
    expect(result.status).toBe("READY");
    const made = await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, row.id) });
    expect(made?.status).toBe("READY");
    expect(made?.isCurrent).toBe(true);
    expect(made?.provider).toBe("openai");
    expect(made?.plan?.task).toBe("realistic_scene");
    expect(made?.plan?.operation).toBe("generate");
    expect(made?.qa?.verdict).toBe("pass");
    expect((made?.debug as { modelKey?: string }).modelKey).toBe("sunburst");
    // Two candidates for an uncertain photograph: the best is kept, the other is a sibling version.
    const call = fake.calls.at(-1)!;
    expect(call.n).toBe(2);
    expect(call.prompt).toMatch(/No written words/);
    const siblings = await db.query.imageVersions.findMany({ where: and(eq(s.imageVersions.rootId, row.id), eq(s.imageVersions.version, 1)) });
    expect(siblings).toHaveLength(1);
    expect(siblings[0].isCurrent).toBe(false);

    const asset = (await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, made!.mediaId!) }))!;
    expect(asset.organizationId).toBe(orgId);
    expect(asset.editionId).toBe(editionId);
    expect(asset.aiTags).toContain("generated");
    expect(asset.metadata).toMatchObject({ generated: true, imageVersionId: row.id, provider: "openai" });
    expect(asset.rightsNote).toMatch(/Made by Briefly/);
    expect([asset.width, asset.height]).toEqual([1536, 1024]);

    const costs = await db.query.creativeCosts.findMany({ where: and(eq(s.creativeCosts.organizationId, orgId), eq(s.creativeCosts.operation, "image-generate")) });
    expect(costs.length).toBeGreaterThanOrEqual(1);
    expect(costs.at(-1)?.credits).toBe(2);
    expect(Number(costs.at(-1)?.costCents)).toBe(8);

    const views = await pendingViews(orgId, editionId, { showRouting: true });
    const view = views.find((entry) => entry.id === row.id)!;
    expect(view.status).toBe("READY");
    expect(view.previewUrl).toMatch(/\/api\/storage\//);
    expect(view.routing?.modelLabel).toBe("GPT Image (Sunburst)");
    const hidden = (await pendingViews(orgId, editionId, { showRouting: false })).find((entry) => entry.id === row.id)!;
    expect(hidden.routing).toBeNull();
  });

  it("edits a library photograph as a new version, protecting the person and never the original", async () => {
    const before = (await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, photoId) }))!;
    fake.calls = [];
    const row = await requestEdit({ organizationId: orgId, mediaId: photoId, instruction: "Keep everything identical but brighten the plant on the left", actorId: adminId });
    expect(row.version).toBe(2);
    const root = await rootForAsset(before);
    expect(root.operation).toBe("import");
    expect(root.version).toBe(1);
    expect(row.rootId).toBe(root.id);
    expect(row.parentId).toBe(root.id);

    await runImageVersion({ versionId: row.id });
    const made = (await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, row.id) }))!;
    expect(made.status).toBe("READY");
    expect(made.sensitivity).toBe("HIGH");
    expect(made.plan?.operation).toBe("localized_edit");
    expect(made.plan?.preserve).toEqual(expect.arrayContaining(["facial identity", "everything not named in the change"]));
    expect(made.references.map((reference) => reference.role)).toEqual(["current_version"]);
    expect(made.isCurrent).toBe(true);
    expect(made.mediaId).not.toBe(photoId);

    // The provider was handed the picture to change first, with the guard sentences.
    const call = fake.calls[0];
    expect(call.references[0].role).toBe("current_version");
    expect(call.n).toBe(1);
    expect(call.prompt).toMatch(/Keep exactly as in the reference/);
    expect(call.prompt).toMatch(/Every pixel outside/);

    // The original file is byte-for-byte what it was.
    const after = (await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, photoId) }))!;
    expect(after.sha256).toBe(before.sha256);
    expect(after.isArchived).toBe(false);
    expect((await lineage(root.id)).map((version) => version.version)).toEqual([1, 2]);
    const line = await runAsOrganization(orgId, () => lineViewForMedia(photoId, { showRouting: false }));
    expect(line?.current?.id).toBe(row.id);
    expect(line?.versions.map((version) => version.status)).toEqual(["READY", "READY"]);
    expect(line?.versions[0].instruction).toBe("Nadia Chevalier, founder");
  });

  it("catches an answer that changed nothing and asks again", async () => {
    fake.calls = [];
    fake.sameNext = 1;
    const row = await requestEdit({ organizationId: orgId, mediaId: photoId, instruction: "Make the whole picture a little warmer", actorId: adminId });
    await runImageVersion({ versionId: row.id });
    const made = (await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, row.id) }))!;
    expect(made.status).toBe("READY");
    expect(made.attempts).toHaveLength(2);
    expect(made.retries).toBe(1);
    expect(made.attempts[0].qaScore).toBeLessThan(0.7);
    expect(made.qa?.verdict).toBe("pass");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].seed).not.toBe(fake.calls[0].seed);
    // The lazy answer was filed, then put away; it never reaches the library's lists.
    const stats = await modelStats(orgId);
    expect(stats.sunburst.attempts).toBeGreaterThanOrEqual(3);
  });

  it("starts again from the master once a protected subject has been through enough edits", async () => {
    const root = await rootForAsset((await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, photoId) }))!);
    let latest = (await lineage(root.id)).filter((version) => version.status === "READY").at(-1)!;
    let regenerated: typeof latest | null = null;
    for (let index = 0; index < REGENERATE_AFTER + 1 && !regenerated; index += 1) {
      fake.calls = [];
      const row = await requestEdit({ organizationId: orgId, versionId: latest.id, instruction: `Keep her face exactly as it is and change only the jacket colour, take ${index + 1}`, actorId: adminId });
      await runImageVersion({ versionId: row.id });
      latest = (await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, row.id) }))!;
      expect(latest.status).toBe("READY");
      if (latest.operation === "regenerate") regenerated = latest;
    }
    expect(regenerated).not.toBeNull();
    expect(regenerated!.plan?.operation).toBe("regenerate");
    expect(regenerated!.references.map((reference) => reference.role)).toEqual(["original_master"]);
    expect(regenerated!.references[0].mediaId).toBe(photoId);
    // The accumulated specification carries every change since the master.
    expect(regenerated!.plan?.change.filter((line) => /jacket/.test(line)).length).toBeGreaterThanOrEqual(2);
    const call = fake.calls[0];
    expect(call.references.map((reference) => reference.role)).toEqual(["original_master"]);
    expect(call.prompt).toMatch(/Keep exactly as in the reference/);
  });

  it("restores, branches and throws out without losing anything", async () => {
    const root = await rootForAsset((await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, photoId) }))!);
    const line = (await lineage(root.id)).filter((version) => version.status === "READY");
    const v2 = line.find((version) => version.version === 2)!;
    const current = line.find((version) => version.isCurrent)!;
    expect(current.version).toBeGreaterThan(2);

    await runAsOrganization(orgId, () => setCurrentVersion(v2.id, adminId));
    const afterRestore = await lineage(root.id);
    expect(afterRestore.filter((version) => version.isCurrent).map((version) => version.id)).toEqual([v2.id]);
    expect(afterRestore.find((version) => version.id === current.id)?.status).toBe("READY");

    // A branch: a new change from v2, numbered after everything, parented to v2.
    const branch = await requestEdit({ organizationId: orgId, versionId: v2.id, instruction: "Make it warmer", actorId: adminId });
    expect(branch.parentId).toBe(v2.id);
    expect(branch.version).toBe(Math.max(...afterRestore.map((version) => version.version)) + 1);
    await runImageVersion({ versionId: branch.id });
    const madeBranch = (await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, branch.id) }))!;
    expect(madeBranch.isCurrent).toBe(true);

    // Thrown out: greyed in the line, its file put away, the current marker back on its parent.
    await runAsOrganization(orgId, () => rejectVersion(branch.id, adminId));
    const rejected = (await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, branch.id) }))!;
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.accepted).toBe(false);
    expect((await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, madeBranch.mediaId!) }))?.isArchived).toBe(true);
    expect((await lineage(root.id)).filter((version) => version.isCurrent).map((version) => version.id)).toEqual([v2.id]);
    await expect(runAsOrganization(orgId, () => rejectVersion(root.id, adminId))).rejects.toBeInstanceOf(ValidationError);
    await expect(runAsOrganization(orgId, () => setCurrentVersion(branch.id, adminId))).rejects.toBeInstanceOf(ValidationError);
  });

  it("says plainly when nothing connected can do the job, and keeps the failure", async () => {
    setImageProvidersForTests({});
    try {
      const row = await requestImage({ organizationId: orgId, editionId, instruction: "A poster with a bold headline", actorId: adminId });
      await expect(runImageVersion({ versionId: row.id })).rejects.toThrow(/No connected picture service/);
      const failed = (await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, row.id) }))!;
      expect(failed.status).toBe("FAILED");
      expect(failed.error).toMatch(/not connected/);
    } finally {
      setImageProvidersForTests({ openai: fake });
    }
  });

  it("keeps every workspace's pictures behind its own wall", async () => {
    const root = await rootForAsset((await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, photoId) }))!);
    await expect(requestEdit({ organizationId: otherOrgId, mediaId: photoId, instruction: "Make it warmer", actorId: adminId })).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestEdit({ organizationId: otherOrgId, versionId: root.id, instruction: "Make it warmer", actorId: adminId })).rejects.toBeInstanceOf(NotFoundError);
    await expect(requestImage({ organizationId: otherOrgId, editionId: null, instruction: "A calm sea", references: [{ role: "style_reference", mediaId: photoId }], actorId: adminId })).rejects.toBeInstanceOf(NotFoundError);
    await expect(runAsOrganization(otherOrgId, () => getVersion(root.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(runAsOrganization(otherOrgId, () => setCurrentVersion(root.id, adminId))).rejects.toBeInstanceOf(NotFoundError);
    expect(await referenceCandidates(otherOrgId, null)).toEqual([]);
    expect((await referenceCandidates(orgId, editionId)).some((candidate) => candidate.id === photoId)).toBe(true);
  });

  it("stops at the plan's credits before asking anyone", async () => {
    await setOverrides({ organizationId: orgId, patch: { creativeCredits: 0 }, actorId: adminId });
    try {
      await expect(requestImage({ organizationId: orgId, editionId, instruction: "A calm sea at dawn", actorId: adminId })).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      await setOverrides({ organizationId: orgId, patch: { creativeCredits: null }, actorId: adminId });
    }
  });

  it("draws a mask that opens exactly the region asked for", async () => {
    const mask = await maskFor(100, 50, { x: 0.5, y: 0, width: 0.5, height: 1 });
    const { data, info } = await sharp(mask).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([100, 50, 4]);
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(10, 25)).toBe(255);
    expect(alphaAt(75, 25)).toBe(0);
  });

  it("filed nothing under a rejected or lazy answer that a library list would show", async () => {
    const generated = await db.query.mediaAssets.findMany({ where: and(eq(s.mediaAssets.organizationId, orgId), inArray(s.mediaAssets.kind, ["photo", "diagram"])) });
    const fromEngine = generated.filter((asset) => (asset.metadata as { generated?: boolean }).generated);
    const shown = await db.query.imageVersions.findMany({ where: and(eq(s.imageVersions.organizationId, orgId), eq(s.imageVersions.status, "READY")) });
    const shownMedia = new Set(shown.map((version) => version.mediaId));
    for (const asset of fromEngine) if (!shownMedia.has(asset.id)) expect(asset.isArchived).toBe(true);
  });
});
