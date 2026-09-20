import { describe, expect, it } from "vitest";
import { CENTRE, CROP_SHAPES, cropLoss, cropTo, cropsFor, naturalShape, survivesCrop, type FocalPoint } from "@/lib/design/crop";
import { choosePicture, curate, rankPictures, type PictureCandidate } from "@/lib/design/pictures";
import { newIdentity, resolveDirection } from "@/lib/design/identity";
import { genomeFromBrand } from "@/lib/design/genome";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { OUTPUT_MEDIA } from "@/lib/design/roles";
import type { DocumentMedia } from "@/lib/publication/document";

/**
 * Pictures: which ones, in what shape, and which to leave out.
 *
 * The failures the brief names are concrete. A desktop crop reused on a phone takes the top off a
 * portrait (§20). Seventy photographs all get used (§100). The same three open every edition
 * (§54). And the quiet one underneath all of them: a crop that leaves the frame, which produces a
 * black band down one side of a printed page.
 */

const brand = genomeFromBrand(DEFAULT_BRAND_SYSTEM);
const direction = resolveDirection(brand, newIdentity("p1", "The Review"), null);

function media(id: string, extra: Partial<DocumentMedia> = {}): DocumentMedia {
  const width = extra.width ?? 2400;
  const height = extra.height ?? 1600;
  return {
    id,
    kind: "PHOTO",
    caption: null,
    credit: null,
    altText: null,
    width,
    height,
    aspectRatio: width / height,
    rightsStatus: "GREEN",
    src: { print: { key: id, url: "", path: null, width, height }, web: null, thumb: null },
    ...extra,
  };
}

function candidate(id: string, extra: Partial<PictureCandidate> = {}, mediaExtra: Partial<DocumentMedia> = {}): PictureCandidate {
  return { media: media(id, mediaExtra), focal: CENTRE, appearances: 0, lastUsed: null, similarityGroup: null, ...extra };
}

describe("cropping", () => {
  it("never leaves the picture, whatever the focal point says", () => {
    const image = { width: 2000, height: 1000 };
    for (const focal of [CENTRE, { x: 0, y: 0, confidence: 1 }, { x: 1, y: 1, confidence: 1 }, { x: 0.5, y: 0, confidence: 0.8 }] as FocalPoint[]) {
      for (const aspect of Object.values(CROP_SHAPES)) {
        const box = cropTo(image, aspect, focal);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(image.width);
        expect(box.y + box.height).toBeLessThanOrEqual(image.height);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the subject when the subject is not in the middle", () => {
    // A portrait photograph with the face high and to the left.
    const image = { width: 1600, height: 2400 };
    const face: FocalPoint = { x: 0.35, y: 0.25, confidence: 0.9 };
    const wide = cropTo(image, CROP_SHAPES.wide, face);
    // The crop band contains the face, which a centred crop of this picture would have cut off.
    const faceY = face.y * image.height;
    expect(faceY).toBeGreaterThanOrEqual(wide.y);
    expect(faceY).toBeLessThanOrEqual(wide.y + wide.height);
    const centred = cropTo(image, CROP_SHAPES.wide, CENTRE);
    expect(wide.y).toBeLessThan(centred.y);
  });

  it("ignores a focal point nobody is sure of", () => {
    const image = { width: 2000, height: 1200 };
    const unsure = cropTo(image, CROP_SHAPES.square, { x: 0.1, y: 0.9, confidence: 0 });
    expect(unsure).toEqual(cropTo(image, CROP_SHAPES.square, CENTRE));
  });

  it("gives every medium the shapes it actually needs", () => {
    const image = { width: 3000, height: 2000 };
    for (const medium of OUTPUT_MEDIA) {
      const crops = cropsFor(image, medium);
      expect(crops.length, medium).toBeGreaterThan(0);
      for (const crop of crops) {
        expect(crop.box.width / crop.box.height).toBeCloseTo(CROP_SHAPES[crop.name], 1);
        expect(crop.aspect).toMatch(/^\d+:\d+$/);
      }
    }
    // A phone's crop is not the desktop's.
    const web = cropsFor(image, "web");
    expect(web[0].box).not.toEqual(cropsFor(image, "social")[0].box);
  });

  it("says how much a crop costs, and whether the picture survives it", () => {
    const portrait = { width: 1200, height: 1800 };
    const box = cropTo(portrait, CROP_SHAPES.wide);
    // A 16:9 crop of a portrait throws most of it away, and says so.
    expect(cropLoss(portrait, box)).toBeGreaterThan(0.5);
    expect(survivesCrop(portrait, CROP_SHAPES.wide, 1000)).toBe(true);
    expect(survivesCrop(portrait, CROP_SHAPES.wide, 2000)).toBe(false);
  });

  it("knows what shape a picture already is", () => {
    expect(naturalShape({ width: 1600, height: 900 })).toBe("wide");
    expect(naturalShape({ width: 1000, height: 1000 })).toBe("square");
    expect(naturalShape({ width: 800, height: 1200 })).toBe("tall");
  });
});

describe("choosing a picture", () => {
  const need = { shape: "landscape" as const, minWidth: 1200 };

  it("prefers the picture that is already the right shape", () => {
    const right = candidate("right", {}, { width: 2400, height: 1600 });
    const wrong = candidate("wrong", {}, { width: 1600, height: 2400 });
    const chosen = choosePicture([wrong, right], need, direction);
    expect(chosen?.mediaId).toBe("right");
    expect(chosen?.because).toContain("already the right shape");
  });

  it("will not choose a picture too small for the space", () => {
    const small = candidate("small", {}, { width: 900, height: 600 });
    expect(choosePicture([small], { shape: "landscape", minWidth: 1600 }, direction)).toBeNull();
  });

  it("holds back a picture the readers have already seen", () => {
    const fresh = candidate("fresh");
    const seen = candidate("seen", { appearances: 2, lastUsed: new Date(Date.now() - 30 * 86_400_000) });
    const ranked = rankPictures([seen, fresh], need, direction);
    expect(ranked[0].mediaId).toBe("fresh");
    expect(ranked[1].because).toContain("has run 2 times");
  });

  it("treats unconfirmed rights as a risk rather than a blocker, and refused rights as a blocker", () => {
    const yellow = candidate("yellow", {}, { rightsStatus: "YELLOW" });
    const green = candidate("green");
    expect(rankPictures([yellow, green], need, direction)[0].mediaId).toBe("green");
    expect(rankPictures([yellow], need, direction)).toHaveLength(1);
    expect(rankPictures([candidate("red", {}, { rightsStatus: "RED" })], need, direction)).toEqual([]);
  });

  it("wants a person where a person is wanted", () => {
    const person = candidate("person", {}, { kind: "PORTRAIT", width: 1600, height: 2000 });
    const building = candidate("building", {}, { width: 2400, height: 1600 });
    const chosen = choosePicture([building, person], { shape: "portrait", minWidth: 800, wantsPortrait: true }, direction);
    expect(chosen?.mediaId).toBe("person");
  });

  it("does not use the same picture twice on one surface", () => {
    const taken = new Set(["a"]);
    const ranked = rankPictures([candidate("a"), candidate("b")], { ...need, taken }, direction);
    expect(ranked.map((choice) => choice.mediaId)).toEqual(["b"]);
  });

  it("offers what else could have been used", () => {
    const ranked = rankPictures([candidate("a"), candidate("b"), candidate("c")], need, direction);
    expect(ranked[0].alternatives).toContain("b");
    expect(ranked[0].alternatives).not.toContain("a");
  });
});

describe("curating an edition's pictures", () => {
  it("chooses, rather than using all seventy", () => {
    const many = Array.from({ length: 70 }, (_, i) => candidate(`m${i}`, {}, { width: 2000 + i, height: 1333 }));
    const { chosen, left } = curate(many, { limit: 11 }, direction);
    expect(chosen).toHaveLength(11);
    expect(left).toHaveLength(59);
    expect(left[0].why).toContain("already has the pictures it needs");
  });

  it("takes one of a set of near-duplicates, not four", () => {
    const set = [
      candidate("d1", { similarityGroup: "g1" }),
      candidate("d2", { similarityGroup: "g1" }),
      candidate("d3", { similarityGroup: "g1" }),
      candidate("other", { similarityGroup: "g2" }),
    ];
    const { chosen, left } = curate(set, { limit: 10 }, direction);
    expect(chosen).toHaveLength(2);
    expect(left.filter((item) => item.why.includes("almost the same"))).toHaveLength(2);
  });

  it("does not let one story take all the pictures", () => {
    const perStory = new Map([["story-a", ["a1", "a2", "a3", "a4", "a5"]], ["story-b", ["b1"]]]);
    const candidates = [...perStory.get("story-a")!, ...perStory.get("story-b")!].map((id) => candidate(id));
    const { chosen } = curate(candidates, { limit: 10, perStory, maxPerStory: 2 }, direction);
    expect(chosen.filter((id) => id.startsWith("a"))).toHaveLength(2);
    expect(chosen).toContain("b1");
  });

  it("never chooses a picture nobody has the right to publish", () => {
    const { chosen, left } = curate([candidate("ok"), candidate("no", {}, { rightsStatus: "RED" })], { limit: 10 }, direction);
    expect(chosen).toEqual(["ok"]);
    expect(left[0].why).toContain("right to publish");
  });
});
