import type { OutputMedium } from "./roles";

/**
 * Cropping, per medium, without touching the original.
 *
 * §20 and §55 of the design brief: a photograph has a desktop crop, a mobile crop, an email crop, a
 * print crop and a social crop, and reusing the desktop one everywhere is how a portrait ends up
 * with its subject's head removed on a phone. So a crop is a rectangle computed from the picture's
 * own focal point and the shape the design needs — stored, never applied destructively, and
 * recomputed when the design asks for a different shape rather than when the photograph changes.
 *
 * All of this is arithmetic on a rectangle. Finding the focal point needs the pixels and lives on
 * the server; deciding what to do with it does not, and lives here where it can be tested.
 */

export type Box = { x: number; y: number; width: number; height: number };

/** Where the picture is about, as a fraction of its own width and height. */
export type FocalPoint = { x: number; y: number; /** 0–1: how sure the detector is. Low means fall back to the centre. */ confidence: number };

export const CENTRE: FocalPoint = { x: 0.5, y: 0.5, confidence: 0 };

/**
 * The shapes the design actually asks for.
 *
 * Deliberately few. Every extra aspect is another crop to store, another thing to get wrong, and
 * another way for the same photograph to look like a different photograph in two places.
 */
export const CROP_SHAPES = {
  wide: 16 / 9,
  landscape: 3 / 2,
  classic: 4 / 3,
  square: 1,
  portrait: 4 / 5,
  tall: 2 / 3,
  /** A full page, for a print bleed. */
  page: 210 / 297,
  /** A phone, held up. */
  story: 9 / 16,
} as const;
export type CropShape = keyof typeof CROP_SHAPES;

/** What each medium wants, in the order it wants them. */
export const MEDIUM_SHAPES: Record<OutputMedium, CropShape[]> = {
  print: ["landscape", "page", "portrait", "square"],
  web: ["wide", "landscape", "portrait", "square"],
  email: ["landscape", "square"],
  docx: ["landscape"],
  social: ["square", "portrait", "story"],
};

/**
 * The crop, kept inside the picture and centred on what the picture is about.
 *
 * Three rules, in order of stubbornness: the crop never leaves the image, it is as large as the
 * aspect allows, and it is placed so the focal point sits where the eye expects it — centred
 * horizontally, and slightly above centre vertically, because a face placed dead-centre in a
 * landscape frame reads as a passport photograph.
 */
export function cropTo(image: { width: number; height: number }, aspect: number, focal: FocalPoint = CENTRE): Box {
  const source = image.width / image.height;
  let width: number;
  let height: number;
  if (source > aspect) {
    // The picture is wider than the shape: full height, narrower width.
    height = image.height;
    width = Math.round(height * aspect);
  } else {
    width = image.width;
    height = Math.round(width / aspect);
  }
  width = Math.min(width, image.width);
  height = Math.min(height, image.height);

  // A confident focal point pulls the frame; an unconfident one leaves it centred.
  const pull = Math.min(1, Math.max(0, focal.confidence));
  const targetX = 0.5 + (focal.x - 0.5) * pull;
  // The rule of thirds, applied gently: the subject sits a little above the middle.
  const targetY = 0.5 + (focal.y - 0.5) * pull - (height < image.height ? 0.04 * pull : 0);

  const x = clamp(Math.round(targetX * image.width - width / 2), 0, image.width - width);
  const y = clamp(Math.round(targetY * image.height - height / 2), 0, image.height - height);
  return { x, y, width, height };
}

/** Every crop a medium needs from one picture, named so a renderer can ask for one by shape. */
export function cropsFor(image: { width: number; height: number }, medium: OutputMedium, focal: FocalPoint = CENTRE): { name: CropShape; aspect: string; box: Box }[] {
  return MEDIUM_SHAPES[medium].map((name) => ({
    name,
    aspect: aspectLabel(name),
    box: cropTo(image, CROP_SHAPES[name], focal),
  }));
}

function aspectLabel(shape: CropShape): string {
  switch (shape) {
    case "wide":
      return "16:9";
    case "landscape":
      return "3:2";
    case "classic":
      return "4:3";
    case "square":
      return "1:1";
    case "portrait":
      return "4:5";
    case "tall":
      return "2:3";
    case "page":
      return "210:297";
    case "story":
      return "9:16";
  }
}

/**
 * How much of the picture a crop throws away, and whether that is too much.
 *
 * A 16:9 crop of a portrait photograph keeps about a third of it. Sometimes that is the right
 * answer and sometimes it means the wrong picture was chosen for the shape — which is a decision
 * the composer should be told about rather than one a renderer should make silently.
 */
export function cropLoss(image: { width: number; height: number }, box: Box): number {
  const kept = (box.width * box.height) / (image.width * image.height);
  return Math.round((1 - kept) * 100) / 100;
}

/** Whether cropping this picture to this shape would leave it too small to print or show. */
export function survivesCrop(image: { width: number; height: number }, aspect: number, minWidth: number, focal: FocalPoint = CENTRE): boolean {
  return cropTo(image, aspect, focal).width >= minWidth;
}

/**
 * The shape a picture already is, so the composer can prefer the crop that costs nothing.
 *
 * A photograph used in the shape it was taken in looks like a photograph; the same photograph
 * forced into a shape it was not taken in looks like a decision somebody should have made
 * differently.
 */
export function naturalShape(image: { width: number; height: number }): CropShape {
  const ratio = image.width / image.height;
  let best: CropShape = "landscape";
  let distance = Infinity;
  for (const [name, aspect] of Object.entries(CROP_SHAPES) as [CropShape, number][]) {
    const difference = Math.abs(Math.log(ratio / aspect));
    if (difference < distance) {
      distance = difference;
      best = name;
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
