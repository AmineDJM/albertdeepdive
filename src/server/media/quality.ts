export type QualityInput = {
  width: number;
  height: number;
  sizeBytes: number;
  format: string;
  kind: string; // photo | logo | screenshot | diagram | chart | document
  sharpness?: number | null; // std dev of luminance (proxy)
};

export type QualityResult = { score: number; flags: string[] };

/**
 * Heuristic print-readiness score (0–100). Photos need resolution; logos and diagrams are
 * judged more leniently. Flags are stable codes used by the media library filters.
 */
export function scoreQuality(input: QualityInput): QualityResult {
  const flags: string[] = [];
  const megapixels = (input.width * input.height) / 1_000_000;
  const longest = Math.max(input.width, input.height);
  let score = 100;

  if (input.kind === "photo") {
    if (longest < 800) {
      flags.push("VERY_LOW_RESOLUTION");
      score -= 55;
    } else if (longest < 1400) {
      flags.push("LOW_RESOLUTION");
      score -= 30;
    } else if (longest < 2000) {
      score -= 10;
    }
    if (megapixels < 0.5) score -= 10;
  } else if (longest < 400) {
    flags.push("LOW_RESOLUTION");
    score -= 25;
  }

  const bytesPerPixel = input.sizeBytes / Math.max(1, input.width * input.height);
  if ((input.format === "jpeg" || input.format === "jpg") && input.kind === "photo") {
    if (bytesPerPixel < 0.06) {
      flags.push("HEAVY_COMPRESSION");
      score -= 25;
    } else if (bytesPerPixel < 0.12) {
      score -= 8;
    }
  }

  if (input.sharpness !== null && input.sharpness !== undefined && input.kind === "photo") {
    if (input.sharpness < 18) {
      flags.push("LOW_CONTRAST");
      score -= 10;
    }
  }

  const ratio = input.width / Math.max(1, input.height);
  if (ratio > 3.2 || ratio < 0.31) flags.push("EXTREME_ASPECT_RATIO");

  return { score: Math.max(0, Math.min(100, Math.round(score))), flags };
}

export function suggestCrops(width: number, height: number) {
  const targets = [
    { name: "hero", aspect: "3:2", value: 3 / 2 },
    { name: "square", aspect: "1:1", value: 1 },
    { name: "portrait", aspect: "4:5", value: 4 / 5 },
    { name: "wide", aspect: "16:9", value: 16 / 9 },
  ];
  return targets.map((t) => {
    let w = width;
    let h = Math.round(width / t.value);
    if (h > height) {
      h = height;
      w = Math.round(height * t.value);
    }
    return { name: t.name, aspect: t.aspect, x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), width: w, height: h };
  });
}
