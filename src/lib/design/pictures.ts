import type { DocumentMedia } from "@/lib/publication/document";
import { CROP_SHAPES, cropLoss, cropTo, naturalShape, survivesCrop, type CropShape, type FocalPoint } from "./crop";
import type { ResolvedDirection } from "./identity";

/**
 * Choosing which photographs to use, and which to leave out.
 *
 * §53 and §100 of the design brief. Seventy photographs arrive and an edition needs eleven; the
 * failure is not picking badly, it is picking *all of them*, because a contact sheet is not an
 * edition. And §54: the library is an editorial memory, so a picture that ran last month and the
 * month before should not open this one either.
 *
 * What makes a picture the right one here is not aesthetic judgement — that needs eyes, and the
 * critic has them. It is fit: is it cleared, is it big enough for the shape it is being asked to
 * fill, does it survive the crop, is it the same as the one beside it, has this reader seen it
 * already.
 */

export type PictureCandidate = {
  media: DocumentMedia;
  focal: FocalPoint;
  /** How many times this asset has already appeared in a published edition. */
  appearances: number;
  /** When it last appeared, for the recency penalty. */
  lastUsed: Date | null;
  /** Perceptual hash group, so near-duplicates can be recognised as near-duplicates. */
  similarityGroup: string | null;
};

export type PictureNeed = {
  /** The shape the design has asked for. */
  shape: CropShape;
  /** The smallest width that will do, in pixels, at the size it will be drawn. */
  minWidth: number;
  /** Whether this slot wants a person. */
  wantsPortrait?: boolean;
  /** Ids already chosen for this surface, so the same picture is not used twice on one page. */
  taken?: Set<string>;
};

export type PictureChoice = {
  mediaId: string;
  shape: CropShape;
  box: ReturnType<typeof cropTo>;
  /** 0–1. What it lost to the crop. */
  loss: number;
  score: number;
  because: string;
  /** The ones considered and not chosen, best first, for "use a different picture". */
  alternatives: string[];
};

/**
 * Rank the candidates for one slot.
 *
 * Every rejection is a reason, not a silent drop: a photograph that cannot be used because it is
 * 600 pixels wide is a fact an editor may want to know, and one excluded because it ran twice this
 * year is a judgement they may want to overrule.
 */
export function rankPictures(candidates: PictureCandidate[], need: PictureNeed, direction: ResolvedDirection, now = new Date()): PictureChoice[] {
  const aspect = CROP_SHAPES[need.shape];
  const scored: PictureChoice[] = [];

  for (const candidate of candidates) {
    const { media } = candidate;
    if (need.taken?.has(media.id)) continue;
    if (media.rightsStatus === "RED") continue;

    const width = media.src.print?.width ?? media.width ?? 0;
    const height = media.src.print?.height ?? media.height ?? 0;
    if (!width || !height) continue;
    if (!survivesCrop({ width, height }, aspect, need.minWidth, candidate.focal)) continue;

    const box = cropTo({ width, height }, aspect, candidate.focal);
    const loss = cropLoss({ width, height }, box);

    let score = 0.5;
    const reasons: string[] = [];

    // A picture already the right shape is worth more than a bigger one that must be cut down.
    if (naturalShape({ width, height }) === need.shape) {
      score += 0.2;
      reasons.push("already the right shape");
    }
    score -= loss * 0.45;
    if (loss > 0.55) reasons.push("loses more than half the frame");

    // Resolution, past what is needed, with diminishing returns: twice the minimum is plenty.
    score += Math.min(0.2, (box.width / Math.max(1, need.minWidth) - 1) * 0.1);

    if (need.wantsPortrait) {
      const portraitish = media.kind === "PORTRAIT" || (media.aspectRatio ?? 1.5) < 1.05;
      if (portraitish) {
        score += 0.25;
        reasons.push("a person, for a slot that wants one");
      } else {
        score -= 0.3;
      }
    }

    // Rights that nobody has confirmed are a risk the design should not take on its own.
    if (media.rightsStatus === "YELLOW") {
      score -= 0.25;
      reasons.push("rights not confirmed");
    }

    // The memory. A picture the reader saw last month is not a fresh picture, however good it is.
    if (candidate.appearances > 0) {
      const months = candidate.lastUsed ? (now.getTime() - candidate.lastUsed.getTime()) / (30 * 86_400_000) : 12;
      const recency = Math.max(0, 1 - months / 12);
      score -= Math.min(0.45, candidate.appearances * 0.12 + recency * 0.25);
      reasons.push(candidate.appearances === 1 ? "has run once before" : `has run ${candidate.appearances} times`);
    }

    // A publication that leads on photography is more willing to accept an imperfect crop than one
    // that uses pictures sparingly and can simply not use this one.
    score += (direction.imagery.emphasis - 0.5) * 0.1;

    scored.push({
      mediaId: media.id,
      shape: need.shape,
      box,
      loss,
      score: Math.round(score * 1000) / 1000,
      because: reasons.join("; ") || "it fits",
      alternatives: [],
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((choice, index) => ({ ...choice, alternatives: scored.slice(index + 1, index + 4).map((other) => other.mediaId) }));
}

/** The best picture for a slot, or nothing — which is a real answer and must stay one. */
export function choosePicture(candidates: PictureCandidate[], need: PictureNeed, direction: ResolvedDirection, now = new Date()): PictureChoice | null {
  return rankPictures(candidates, need, direction, now)[0] ?? null;
}

/**
 * Curate a whole edition's worth: the strongest pictures, spread across the stories that have them.
 *
 * The rule that matters when seventy arrive: no near-duplicate of something already chosen, and no
 * story taking more than its share. A photo essay is a decision the director makes; nine pictures
 * of one event because that contributor uploaded nine is an accident.
 */
export function curate(candidates: PictureCandidate[], options: { limit: number; perStory?: Map<string, string[]>; maxPerStory?: number }, direction: ResolvedDirection): { chosen: string[]; left: { mediaId: string; why: string }[] } {
  const maxPerStory = options.maxPerStory ?? Math.max(1, direction.imagery.maxPerSurface);
  const byStory = new Map<string, number>();
  const groups = new Set<string>();
  const chosen: string[] = [];
  const left: { mediaId: string; why: string }[] = [];

  const storyOf = (mediaId: string): string | null => {
    if (!options.perStory) return null;
    for (const [storyId, ids] of options.perStory) if (ids.includes(mediaId)) return storyId;
    return null;
  };

  const ranked = [...candidates].sort((a, b) => quality(b) - quality(a));
  for (const candidate of ranked) {
    if (chosen.length >= options.limit) {
      left.push({ mediaId: candidate.media.id, why: "the edition already has the pictures it needs" });
      continue;
    }
    if (candidate.media.rightsStatus === "RED") {
      left.push({ mediaId: candidate.media.id, why: "nobody has the right to publish it" });
      continue;
    }
    // Near-duplicates: one of a group is a picture, four of a group is a contact sheet.
    if (candidate.similarityGroup && groups.has(candidate.similarityGroup)) {
      left.push({ mediaId: candidate.media.id, why: "almost the same as one already chosen" });
      continue;
    }
    const story = storyOf(candidate.media.id);
    if (story) {
      const used = byStory.get(story) ?? 0;
      if (used >= maxPerStory) {
        left.push({ mediaId: candidate.media.id, why: "that story already has its share of the pictures" });
        continue;
      }
      byStory.set(story, used + 1);
    }
    if (candidate.similarityGroup) groups.add(candidate.similarityGroup);
    chosen.push(candidate.media.id);
  }
  return { chosen, left };
}

function quality(candidate: PictureCandidate): number {
  const width = candidate.media.src.print?.width ?? candidate.media.width ?? 0;
  const resolution = Math.min(1, width / 2400);
  const rights = candidate.media.rightsStatus === "GREEN" ? 0.25 : 0;
  const fresh = candidate.appearances === 0 ? 0.2 : 0;
  return resolution * 0.5 + rights + fresh;
}
