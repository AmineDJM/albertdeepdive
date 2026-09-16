import { describe, expect, it } from "vitest";
import { scoreQuality, suggestCrops } from "@/server/media/quality";

describe("scoreQuality", () => {
  it("gives a clean, large, well-compressed photo a top score", () => {
    const r = scoreQuality({
      width: 4000,
      height: 3000,
      sizeBytes: 4_000_000,
      format: "jpeg",
      kind: "photo",
      sharpness: 55,
    });
    expect(r.score).toBe(100);
    expect(r.flags).toEqual([]);
  });

  it("flags very low resolution photos and drops the score sharply", () => {
    const r = scoreQuality({
      width: 600,
      height: 400,
      sizeBytes: 200_000,
      format: "jpeg",
      kind: "photo",
    });
    expect(r.flags).toContain("VERY_LOW_RESOLUTION");
    expect(r.score).toBeLessThan(60);
  });

  it("flags low resolution between 800 and 1400 px", () => {
    const r = scoreQuality({
      width: 1200,
      height: 800,
      sizeBytes: 500_000,
      format: "jpeg",
      kind: "photo",
      sharpness: 50,
    });
    expect(r.flags).toEqual(["LOW_RESOLUTION"]);
    expect(r.score).toBe(70);
  });

  it("flags heavy JPEG compression from bytes per pixel", () => {
    const r = scoreQuality({
      width: 3000,
      height: 2000,
      sizeBytes: 200_000,
      format: "jpeg",
      kind: "photo",
      sharpness: 50,
    });
    expect(r.flags).toContain("HEAVY_COMPRESSION");
    const png = scoreQuality({
      width: 3000,
      height: 2000,
      sizeBytes: 200_000,
      format: "png",
      kind: "photo",
      sharpness: 50,
    });
    expect(png.flags).not.toContain("HEAVY_COMPRESSION");
  });

  it("flags low contrast photos only", () => {
    const photo = scoreQuality({
      width: 3000,
      height: 2000,
      sizeBytes: 3_000_000,
      format: "jpeg",
      kind: "photo",
      sharpness: 10,
    });
    expect(photo.flags).toContain("LOW_CONTRAST");
    const logo = scoreQuality({
      width: 3000,
      height: 2000,
      sizeBytes: 3_000_000,
      format: "png",
      kind: "logo",
      sharpness: 10,
    });
    expect(logo.flags).not.toContain("LOW_CONTRAST");
  });

  it("judges logos and diagrams leniently", () => {
    const logo = scoreQuality({
      width: 500,
      height: 500,
      sizeBytes: 20_000,
      format: "png",
      kind: "logo",
    });
    expect(logo.score).toBe(100);
    expect(logo.flags).toEqual([]);
    const tiny = scoreQuality({
      width: 300,
      height: 300,
      sizeBytes: 20_000,
      format: "png",
      kind: "diagram",
    });
    expect(tiny.flags).toEqual(["LOW_RESOLUTION"]);
    expect(tiny.score).toBe(75);
  });

  it("flags extreme aspect ratios without scoring them down", () => {
    const banner = scoreQuality({
      width: 4000,
      height: 1000,
      sizeBytes: 4_000_000,
      format: "jpeg",
      kind: "photo",
      sharpness: 50,
    });
    expect(banner.flags).toEqual(["EXTREME_ASPECT_RATIO"]);
    expect(banner.score).toBe(100);
  });

  it("clamps the score to 0..100", () => {
    const r = scoreQuality({
      width: 100,
      height: 100,
      sizeBytes: 100,
      format: "jpeg",
      kind: "photo",
      sharpness: 1,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("suggestCrops", () => {
  it("returns the four editorial crops, centred and inside the image", () => {
    const crops = suggestCrops(3000, 2000);
    expect(crops.map((c) => c.name)).toEqual(["hero", "square", "portrait", "wide"]);
    for (const c of crops) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(3000);
      expect(c.y + c.height).toBeLessThanOrEqual(2000);
      // Centred: the margins on both sides differ by at most a rounding pixel.
      expect(Math.abs(c.x - (3000 - c.width - c.x))).toBeLessThanOrEqual(1);
      expect(Math.abs(c.y - (2000 - c.height - c.y))).toBeLessThanOrEqual(1);
    }
  });

  it("matches the target aspect ratios", () => {
    const crops = suggestCrops(3000, 2000);
    const byName = Object.fromEntries(crops.map((c) => [c.name, c]));
    expect(byName.hero.width / byName.hero.height).toBeCloseTo(1.5, 2);
    expect(byName.square.width).toBe(byName.square.height);
    expect(byName.portrait.width / byName.portrait.height).toBeCloseTo(0.8, 2);
    expect(byName.wide.width / byName.wide.height).toBeCloseTo(16 / 9, 2);
  });

  it("uses the full width when the image is taller than the target", () => {
    const [hero] = suggestCrops(1000, 2000);
    expect(hero.width).toBe(1000);
    expect(hero.height).toBe(667);
    expect(hero.x).toBe(0);
  });

  it("uses the full height when the image is wider than the target", () => {
    const crops = suggestCrops(4000, 1000);
    const square = crops.find((c) => c.name === "square")!;
    expect(square.height).toBe(1000);
    expect(square.width).toBe(1000);
    expect(square.x).toBe(1500);
  });
});
