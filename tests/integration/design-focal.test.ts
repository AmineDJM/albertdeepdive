import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { focalPointOf } from "@/server/design/focal";
import { mediaMemory, storeFocal, storedFocal, unusedPictures } from "@/server/design/memory";
import { cropTo, CROP_SHAPES } from "@/lib/design/crop";

/**
 * Finding what a photograph is about, and remembering what has already run.
 *
 * The focal point is tested against pictures built to have a known answer: a bright, busy square in
 * one corner of an otherwise flat frame is what every photograph with one subject looks like to a
 * detail detector. The case that matters as much is the opposite one — detail everywhere — where
 * the honest answer is "no focal point", and a low confidence is what keeps the crop centred
 * instead of drifting toward whichever corner happened to win.
 */

/** A flat grey frame with one busy patch, which is what a subject looks like to a detail detector. */
async function frameWithSubject(width: number, height: number, at: { x: number; y: number }, patch = 90): Promise<Buffer> {
  const noise = Buffer.alloc(patch * patch);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 37 + Math.floor(i / patch) * 91) % 255;
  const subject = await sharp(noise, { raw: { width: patch, height: patch, channels: 1 } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .composite([{ input: subject, left: Math.round(at.x * width) - patch / 2, top: Math.round(at.y * height) - patch / 2 }])
    .png()
    .toBuffer();
}

describe("what a photograph is about", () => {
  it("finds a subject that is not in the middle", async () => {
    const image = await frameWithSubject(800, 600, { x: 0.25, y: 0.3 });
    const focal = await focalPointOf(image);
    expect(focal.confidence).toBeGreaterThan(0.2);
    expect(focal.x).toBeLessThan(0.5);
    expect(focal.y).toBeLessThan(0.5);
  });

  it("finds it on the other side too, so it is reading the picture rather than a habit", async () => {
    const focal = await focalPointOf(await frameWithSubject(800, 600, { x: 0.78, y: 0.7 }));
    expect(focal.x).toBeGreaterThan(0.5);
    expect(focal.y).toBeGreaterThan(0.5);
  });

  it("says it does not know, for a picture with detail everywhere", async () => {
    const width = 400;
    const height = 400;
    const noise = Buffer.alloc(width * height);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 7919) % 255;
    const busy = await sharp(noise, { raw: { width, height, channels: 1 } }).png().toBuffer();
    const focal = await focalPointOf(busy);
    // Low confidence keeps the crop centred, which is what a person does with the same picture.
    expect(focal.confidence).toBeLessThan(0.4);
  });

  it("returns the centre for a picture it cannot read, rather than failing the render", async () => {
    const focal = await focalPointOf(Buffer.from("not an image"));
    expect(focal).toEqual({ x: 0.5, y: 0.5, confidence: 0 });
  });

  it("keeps the subject in the crop it produces", async () => {
    const image = await frameWithSubject(1200, 900, { x: 0.2, y: 0.25 });
    const focal = await focalPointOf(image);
    const box = cropTo({ width: 1200, height: 900 }, CROP_SHAPES.square, focal);
    const subjectX = 0.2 * 1200;
    const subjectY = 0.25 * 900;
    expect(subjectX).toBeGreaterThanOrEqual(box.x);
    expect(subjectX).toBeLessThanOrEqual(box.x + box.width);
    expect(subjectY).toBeGreaterThanOrEqual(box.y);
    expect(subjectY).toBeLessThanOrEqual(box.y + box.height);
  });

  it("reads the same picture the same way twice", async () => {
    const image = await frameWithSubject(600, 600, { x: 0.7, y: 0.3 });
    expect(await focalPointOf(image)).toEqual(await focalPointOf(image));
  });
});

describe("the library's memory", () => {
  let organizationId: string;
  let editionId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
  }, 180_000);

  it("knows which pictures have run, and in which editions", async () => {
    const assets = await db.query.mediaAssets.findMany({ where: eq(s.mediaAssets.organizationId, organizationId), limit: 40, columns: { id: true } });
    const memory = await runAsOrganization(organizationId, () => mediaMemory(organizationId, assets.map((asset) => asset.id)));
    expect(memory.size).toBe(assets.length);
    for (const use of memory.values()) {
      expect(use.appearances).toBe(use.editions.length);
      // An edition counts once however many of its stories used the picture.
      expect(new Set(use.editions.map((edition) => edition.editionId)).size).toBe(use.editions.length);
    }
  }, 120_000);

  it("does not count the edition being designed as a previous appearance", async () => {
    const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.organizationId, organizationId), columns: { id: true } });
    const all = await runAsOrganization(organizationId, () => mediaMemory(organizationId, [asset!.id]));
    const excluding = await runAsOrganization(organizationId, () => mediaMemory(organizationId, [asset!.id], { exceptEditionId: editionId }));
    expect(excluding.get(asset!.id)!.appearances).toBeLessThanOrEqual(all.get(asset!.id)!.appearances);
    expect(excluding.get(asset!.id)!.editions.some((edition) => edition.editionId === editionId)).toBe(false);
  }, 120_000);

  it("keeps a focal point with the picture it was read from", async () => {
    const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.organizationId, organizationId), columns: { id: true } });
    await runAsOrganization(organizationId, () => storeFocal(asset!.id, { x: 0.31, y: 0.22, confidence: 0.7 }, [{ name: "square", aspect: "1:1", x: 0, y: 0, width: 800, height: 800 }]));
    const read = await runAsOrganization(organizationId, () => storedFocal(asset!.id));
    expect(read).toEqual({ x: 0.31, y: 0.22, confidence: 0.7 });
    const row = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, asset!.id), columns: { suggestedCrops: true, metadata: true } });
    expect(row!.suggestedCrops).toHaveLength(1);
    // The original is untouched: a crop is a rectangle, not an edit.
    expect(row!.metadata).toMatchObject({ focalPoint: { x: 0.31 } });
  }, 120_000);

  it("can say what has never been used", async () => {
    const unused = await runAsOrganization(organizationId, () => unusedPictures(organizationId, 10));
    expect(Array.isArray(unused)).toBe(true);
    const used = new Set((await db.selectDistinct({ id: s.storyMedia.mediaAssetId }).from(s.storyMedia)).map((row) => row.id));
    for (const picture of unused) expect(used.has(picture.id)).toBe(false);
  }, 120_000);
});
