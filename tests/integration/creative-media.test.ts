import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { ensureDefaultPlans } from "@/server/billing/plans";
import { setOverrides } from "@/server/platform/overrides";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPack, deletePack, generatePack } from "@/server/creative/service";

/**
 * The organisation's own photographs reach the Studio.
 *
 * `briefFor` accepted a media list from its first day and was never handed one, so the two modes
 * built around "your own pictures" could not place a single picture, and the image layouts were
 * unreachable from the interface. This pins the join, and the rules on it: cleared rights only,
 * the story's own pictures first, a real photograph never swapped for an invented one.
 */
const STORY_SLUG = "nadia-chevalier-maps-the-weather-from-orbit";
const CLEARED_ALT = "Nadia Chevalier at a whiteboard covered in satellite maps";
const UNCLEARED_ALT = "A photograph whose rights are still to confirm";

describe("photographs in the studio", () => {
  let adminId: string;
  let orgId: string;
  let editionId: string;
  let storyId: string;
  let cleared: string;
  let uncleared: string;

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    editionId = (await db.query.editions.findFirst({ where: eq(s.editions.organizationId, orgId) }))!.id;
    await setOverrides({ organizationId: orgId, patch: { socialPack: true, creativeCredits: null }, actorId: adminId });

    // A story of this run's own, so what is linked to it is exactly what the test linked. The
    // seeded stories carry cleared photographs of their own. Rows left by an earlier run go first.
    await db.delete(s.stories).where(eq(s.stories.slug, STORY_SLUG));
    await db.delete(s.mediaAssets).where(inArray(s.mediaAssets.altText, [CLEARED_ALT, UNCLEARED_ALT]));
    const [story] = await db
      .insert(s.stories)
      .values({ editionId, title: "Nadia Chevalier maps the weather from orbit", slug: STORY_SLUG, status: "SELECTED", summary: "A satellite-data start-up founded by an alumna raises its first round." })
      .returning();
    storyId = story.id;

    const insert = async (rights: "GREEN" | "YELLOW", altText: string) => {
      const [asset] = await db
        .insert(s.mediaAssets)
        .values({ organizationId: orgId, editionId, fileName: "x.jpg", mimeType: "image/jpeg", sizeBytes: 3, storageKey: `media/${crypto.randomUUID()}/original.jpg`, kind: "photo", rightsStatus: rights, altText, orientation: "landscape" } as never)
        .returning();
      await db.insert(s.storyMedia).values({ storyId, mediaAssetId: asset.id, role: "hero", sortOrder: rights === "GREEN" ? 0 : -1 });
      return asset.id;
    };
    // The uncleared one is ordered first on purpose: it must lose to the cleared one on rights, not on position.
    uncleared = await insert("YELLOW", UNCLEARED_ALT);
    cleared = await insert("GREEN", CLEARED_ALT);
  });

  afterAll(async () => {
    await db.delete(s.mediaAssets).where(inArray(s.mediaAssets.id, [cleared, uncleared].filter(Boolean)));
    await db.delete(s.stories).where(eq(s.stories.slug, STORY_SLUG));
  });

  const direct = (name: string, mode: "STUDIO" | "CINEMATIC", scope: { storyId?: string; editionId?: string }) =>
    runAsOrganization(orgId, async () => {
      const pack = await createPack({ organizationId: orgId, name, format: "CAROUSEL", mode, ...scope, actorId: adminId });
      const { pack: directed } = await generatePack({ packId: pack.id, actorId: adminId });
      await deletePack(pack.id, adminId);
      return directed;
    });

  it("opens the pack on a cleared photograph of its own story", async () => {
    const directed = await direct("With a picture", "STUDIO", { storyId });
    const opener = directed.brief!.frames[0];
    expect(opener.layout).toBe("image_full");
    expect(opener.mediaId).toBe(cleared);
    // And the composed spec carries it through to something the renderer will load.
    expect(directed.spec!.frames[0].image?.mediaId).toBe(cleared);
  });

  it("never offers a picture whose rights are not cleared", async () => {
    const directed = await direct("Rights", "STUDIO", { storyId });
    expect(directed.brief!.frames.map((frame) => frame.mediaId).filter(Boolean)).not.toContain(uncleared);
  });

  it("draws on the edition's whole library for an edition pack", async () => {
    const directed = await direct("Whole edition", "STUDIO", { editionId });
    const opener = directed.brief!.frames[0];
    expect(opener.layout).toBe("image_full");
    const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, opener.mediaId!) });
    expect(asset?.editionId).toBe(editionId);
    expect(asset?.rightsStatus).toBe("GREEN");
    expect(asset?.isArchived).toBe(false);
    expect(["photo", "diagram", "chart"]).toContain(asset?.kind);
  });

  it("keeps the photograph in Cinematic rather than replacing it with a generated ground", async () => {
    // Generated imagery is for the frames that have no picture. A real photograph, once chosen, is
    // never swapped for an invented one — that is the rule against fabricated evidence, in code.
    await setOverrides({ organizationId: orgId, patch: { cinematicMode: true, videoGeneration: true }, actorId: adminId });
    const directed = await direct("Cinematic with a picture", "CINEMATIC", { storyId });
    const opener = directed.spec!.frames[0];
    expect(opener.image?.mediaId).toBe(cleared);
    expect(opener.image?.generate).toBeUndefined();
  });

  it("opens on the brand's own colour when nothing is cleared", async () => {
    await db.update(s.mediaAssets).set({ isArchived: true }).where(eq(s.mediaAssets.id, cleared));
    const directed = await direct("No picture", "STUDIO", { storyId });
    expect(directed.brief!.frames[0].layout).toBe("statement");
    expect(directed.brief!.frames.every((frame) => !frame.mediaId)).toBe(true);
  });
});
