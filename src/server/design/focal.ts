import sharp from "sharp";
import { createLogger } from "@/server/logger";
import { CENTRE, type FocalPoint } from "@/lib/design/crop";

const logger = createLogger("design:focal");

/**
 * What a photograph is about, found in the photograph.
 *
 * Not face detection — that needs a model, and a wrong face is worse than no face. This is
 * saliency by detail: the eye goes where the information is, and in almost every photograph that
 * is where local contrast is highest. A portrait's face, a building's façade against the sky, the
 * one lit figure in a dark hall: all of them are the busiest part of an otherwise smooth frame.
 *
 * It is cheap, it is deterministic, and it degrades honestly — a picture with detail everywhere
 * (a crowd, a forest) returns a low confidence, and a low confidence means the crop stays centred,
 * which is exactly what a person would do with the same picture.
 */

const GRID = 12;

export async function focalPointOf(image: Buffer): Promise<FocalPoint> {
  try {
    // Small and grey: the shape of the detail is what matters, not its colour or its size.
    const size = 96;
    const { data, info } = await sharp(image).greyscale().resize(size, size, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    const cellWidth = Math.floor(info.width / GRID);
    const cellHeight = Math.floor(info.height / GRID);
    if (cellWidth < 2 || cellHeight < 2) return CENTRE;

    const energy: number[][] = [];
    let total = 0;
    let peak = 0;
    for (let row = 0; row < GRID; row += 1) {
      energy[row] = [];
      for (let column = 0; column < GRID; column += 1) {
        let sum = 0;
        let sumSquares = 0;
        let count = 0;
        for (let y = row * cellHeight; y < (row + 1) * cellHeight; y += 1) {
          for (let x = column * cellWidth; x < (column + 1) * cellWidth; x += 1) {
            const value = data[y * info.width + x];
            sum += value;
            sumSquares += value * value;
            count += 1;
          }
        }
        // Variance within the cell: smooth sky is near zero, a face is not.
        const mean = sum / count;
        const variance = Math.max(0, sumSquares / count - mean * mean);
        energy[row][column] = variance;
        total += variance;
        peak = Math.max(peak, variance);
      }
    }
    if (total <= 0) return CENTRE;

    /*
     * The centroid of the detail, pulled gently toward the middle.
     *
     * A pure centroid puts the focal point between two subjects at opposite corners, which is the
     * one place neither of them is. The centre bias is what a person does instinctively: when the
     * picture cannot decide, frame the whole of it.
     */
    let weightedX = 0;
    let weightedY = 0;
    let weight = 0;
    for (let row = 0; row < GRID; row += 1) {
      for (let column = 0; column < GRID; column += 1) {
        const value = energy[row][column];
        // Only the cells that carry real detail vote, so a uniformly noisy frame does not drift.
        if (value < peak * 0.35) continue;
        const centreBias = 1 - 0.35 * (Math.abs(column - (GRID - 1) / 2) + Math.abs(row - (GRID - 1) / 2)) / GRID;
        const w = value * centreBias;
        weightedX += ((column + 0.5) / GRID) * w;
        weightedY += ((row + 0.5) / GRID) * w;
        weight += w;
      }
    }
    if (weight <= 0) return CENTRE;

    // Confidence is how concentrated the detail is. Detail everywhere means no focal point, and
    // saying so is more useful than picking one at random.
    const concentration = Math.min(1, peak / (total / (GRID * GRID)) / 6);
    return {
      x: round(weightedX / weight),
      y: round(weightedY / weight),
      confidence: round(Math.max(0, Math.min(0.9, concentration))),
    };
  } catch (err) {
    // A picture that cannot be read is a picture cropped from its centre, not a failed render.
    logger.warn("could not read a picture for its focal point", { err });
    return CENTRE;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
