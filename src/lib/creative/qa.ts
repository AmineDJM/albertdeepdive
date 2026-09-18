import { contrastRatio, hue, saturation } from "@/lib/brand/colour";
import { FORMATS, type CreativeFormat } from "./formats";
import {
  apparentPx,
  CAPTION_VISIBLE_CHARS,
  CAROUSEL_SWEET_SPOT,
  isWeakOpener,
  largeTextThreshold,
  lawById,
  MAX_HASHTAGS,
  MIN_APPARENT_PX,
  SURFACE_PROPORTION,
  vibrates,
  type Law,
} from "./laws";
import type { CreativeBrief, FrameSpec, RenderSpec } from "./brief";

/**
 * What is wrong with a pack, and what can be done about it without asking anybody.
 *
 * Two kinds of problem, kept apart because they need different answers:
 *
 *   A *defect* is something the renderer would faithfully reproduce and nobody would want — type
 *   past the edge of the frame, a colour that cannot be read on its own background, a slide with
 *   nothing on it. These are arithmetic failures, they have deterministic repairs, and the repair
 *   runs without a person.
 *
 *   A *note* is something a person might reasonably have meant. Seven slides with no photograph, a
 *   headline in ALL CAPS THAT IS ALSO VERY LONG, a set with no closing frame. These are shown and
 *   never acted on, because silently rewriting somebody's editorial judgement is worse than the
 *   thing it fixes.
 *
 * The repairs are all in the brief, never in the spec. A spec is the resolved output of a pure
 * function; patching one produces something that no longer matches its own inputs and will differ
 * from the next compose. So a repair changes what the brief asks for and lets the composer redo its
 * arithmetic — which also means every repair is visible in the brief a person can read.
 */

export type Severity = "defect" | "note";

export type Finding = {
  severity: Severity;
  frame: number | null;
  code: string;
  message: string;
  /** Set when the repair pass knows what to do. */
  repairable: boolean;
};

/**
 * Which rule each finding comes from.
 *
 * Kept here rather than on each finding so a code cannot cite a law that does not exist: the test
 * walks this map and asks the catalogue for every id. The studio shows the law's source next to the
 * finding, which is the difference between "Briefly moved your headline" and "Bringhurst says 45–75
 * characters and yours was 91".
 */
const LAW_FOR_CODE: Record<string, string> = {
  contrast: "contrast",
  too_small: "min-size",
  overflow_bottom: "measure",
  overflow_side: "measure",
  weak_opener: "hook",
  two_ctas: "one-cta",
  caption_buried: "caption-first-line",
  many_hashtags: "caption-first-line",
  no_dominant_surface: "proportion",
  vibration: "vibration",
};

/** The rule behind a finding, for the studio to show. Undefined when the finding is not a law. */
export function lawFor(finding: Finding): Law | undefined {
  const id = LAW_FOR_CODE[finding.code];
  return id ? lawById(id) : undefined;
}

const MIN_TEXT_CONTRAST = 4.5;
const MIN_LARGE_CONTRAST = 3;

/**
 * Inspect a composed spec.
 *
 * Runs on the spec rather than on the rendered pixels because everything worth catching is decided
 * in the spec: the renderer is a faithful executor, so a pixel-level check would find the same
 * problems later, more slowly, and with less to say about them.
 */
export function inspect(spec: RenderSpec, brief: CreativeBrief | null): Finding[] {
  const findings: Finding[] = [];
  const format = FORMATS[spec.format as CreativeFormat];
  const safe = format?.safeArea;

  for (const frame of spec.frames) {
    findings.push(...inspectFrame(frame, safe));
  }
  findings.push(...inspectSet(spec, brief));

  if (!spec.frames.length) {
    findings.push({ severity: "defect", frame: null, code: "empty", message: "The pack has no frames.", repairable: false });
  }

  // Notes: things a person might have meant.
  if (format && spec.frames.length < format.minFrames) {
    findings.push({
      severity: "defect",
      frame: null,
      code: "too_few_frames",
      message: `A ${format.name.toLowerCase()} wants at least ${format.minFrames} frames; this has ${spec.frames.length}.`,
      repairable: false,
    });
  }
  if (spec.frames.length > 2 && !spec.frames.some((frame) => frame.image)) {
    findings.push({ severity: "note", frame: null, code: "no_image", message: "Every frame is type. A photograph on one of them would give the set somewhere to breathe.", repairable: false });
  }
  if (brief && !brief.frames.some((frame) => frame.layout === "cta")) {
    findings.push({ severity: "note", frame: null, code: "no_cta", message: "Nothing tells the reader what to do next. A closing frame usually earns its place.", repairable: false });
  }
  if (spec.caption.length > 2000) {
    findings.push({ severity: "note", frame: null, code: "long_caption", message: "The caption is near the platform limit and will be truncated in most feeds.", repairable: false });
  }
  if (brief) {
    brief.frames.forEach((frame, index) => {
      if (frame.headline.length > 90 && frame.emphasis === "loud") {
        findings.push({
          severity: "note",
          frame: index,
          code: "loud_and_long",
          message: "A long headline set loud will copyfit down until it is no longer loud. Shorter or quieter would hold.",
          repairable: false,
        });
      }
    });
  }

  return findings;
}

/**
 * The rules that are about the set rather than about a frame.
 *
 * All judgement, all reported rather than repaired: a carousel that opens on a label is usually a
 * mistake and occasionally the point, and silently rewriting somebody's lead is worse than the
 * thing it fixes.
 */
function inspectSet(spec: RenderSpec, brief: CreativeBrief | null): Finding[] {
  const findings: Finding[] = [];

  // The hook. The first frame is the only one guaranteed to be seen.
  const opener = brief?.frames[0];
  if (opener && isWeakOpener(opener.headline)) {
    findings.push({
      severity: "note",
      frame: 0,
      code: "weak_opener",
      message: `"${opener.headline}" announces that something is coming instead of saying it. The first frame is the only one guaranteed to be seen.`,
      repairable: false,
    });
  }

  // One thing to do. Two asks is no ask.
  const ctas = brief?.frames.filter((frame) => frame.layout === "cta").length ?? 0;
  if (ctas > 1) {
    findings.push({ severity: "note", frame: null, code: "two_ctas", message: `${ctas} closing frames. A reader given a choice of next steps takes neither.`, repairable: false });
  }

  // The visible line. A line break ends a thought as surely as a full stop does — a caption that
  // opens with a headline on its own line has said its piece inside the window, and reporting that
  // as buried teaches people to punctuate headlines, which is not the rule.
  if (spec.caption.length > CAPTION_VISIBLE_CHARS) {
    const visible = spec.caption.slice(0, CAPTION_VISIBLE_CHARS);
    if (!/[.!?\n]/.test(visible)) {
      findings.push({
        severity: "note",
        frame: null,
        code: "caption_buried",
        message: `The caption's point is past the first ${CAPTION_VISIBLE_CHARS} characters, which is where the platform folds it behind a "more".`,
        repairable: false,
      });
    }
  }

  if (spec.hashtags.length > MAX_HASHTAGS) {
    findings.push({ severity: "note", frame: null, code: "many_hashtags", message: `${spec.hashtags.length} hashtags. Past five they stopped helping and started reading as a tell.`, repairable: false });
  }

  // 60/30/10, measured over the frames rather than over area: one surface should hold the set.
  if (spec.frames.length >= 4) {
    const counts = new Map<string, number>();
    for (const frame of spec.frames) counts.set(frame.background, (counts.get(frame.background) ?? 0) + 1);
    const dominant = Math.max(...counts.values()) / spec.frames.length;
    if (counts.size >= 4 && dominant < SURFACE_PROPORTION.secondary + 0.05) {
      findings.push({
        severity: "note",
        frame: null,
        code: "no_dominant_surface",
        message: `${counts.size} different grounds and none of them holds the set. One should dominate, one give structure, one point.`,
        repairable: false,
      });
    }
  }

  const format = FORMATS[spec.format as CreativeFormat];
  if (format?.key === "CAROUSEL" && spec.frames.length > CAROUSEL_SWEET_SPOT.max) {
    findings.push({
      severity: "note",
      frame: null,
      code: "long_carousel",
      message: `${spec.frames.length} slides. Attention falls off sharply past ${CAROUSEL_SWEET_SPOT.max}.`,
      repairable: false,
    });
  }

  return findings;
}

function inspectFrame(frame: FrameSpec, safe?: { top: number; right: number; bottom: number; left: number }): Finding[] {
  const findings: Finding[] = [];
  const readable = frame.text.filter((text) => text.layer !== "background");

  if (!readable.length) {
    findings.push({ severity: "defect", frame: frame.index, code: "blank", message: "The frame has nothing to read.", repairable: false });
  }

  for (const text of readable) {
    const bottom = text.y + text.lines * text.fontSize * text.lineHeight;
    if (bottom > frame.height) {
      findings.push({
        severity: "defect",
        frame: frame.index,
        code: "overflow_bottom",
        message: `"${clip(text.content)}" runs ${Math.round(bottom - frame.height)}px past the bottom.`,
        repairable: true,
      });
    }
    if (text.x < -24 || text.x + text.width > frame.width + 24) {
      findings.push({ severity: "defect", frame: frame.index, code: "overflow_side", message: `"${clip(text.content)}" is outside the canvas.`, repairable: true });
    }

    const onScreen = apparentPx(text.fontSize, frame.width);
    if (onScreen < MIN_APPARENT_PX - 0.5) {
      findings.push({
        severity: "defect",
        frame: frame.index,
        code: "too_small",
        message: `"${clip(text.content)}" is ${onScreen.toFixed(1)}px on a phone, below the ${MIN_APPARENT_PX}px where type stops being read and becomes decoration.`,
        repairable: false,
      });
    }

    // Contrast is checked against whatever is actually behind the block: a chip, a photograph's
    // scrim, or the surface. Checking against the surface alone passes text on a highlight that
    // nobody can read.
    const behind = backgroundUnder(frame, text.x, text.y);
    // WCAG's large-text exemption is about screen pixels, and a 1080 canvas renders at about 390 in
    // a feed. Judging it on the canvas size grants the 3:1 exemption to type that is 17px in the
    // hand, which is exactly what this engine did before the rule was written down.
    const required = text.fontSize >= largeTextThreshold(frame.width, text.fontWeight >= 700) ? MIN_LARGE_CONTRAST : MIN_TEXT_CONTRAST;
    const ratio = contrastRatio(text.colour, behind);
    if (ratio < required - 0.01) {
      findings.push({
        severity: "defect",
        frame: frame.index,
        code: "contrast",
        message: `"${clip(text.content)}" is ${ratio.toFixed(1)}:1 on its background, below the ${required}:1 it needs.`,
        repairable: true,
      });
    }
  }

  if (safe && frame.image?.mediaId === null && frame.image.generate === undefined) {
    findings.push({ severity: "defect", frame: frame.index, code: "missing_image", message: "The frame expects a photograph and has none.", repairable: true });
  }

  // Simultaneous contrast: a saturated shape on its saturated complement makes an edge the eye
  // cannot settle on. Reported rather than repaired, because the two colours are the brand's own and
  // quietly recolouring somebody's chip is not Briefly's decision to make.
  for (const shape of frame.shapes) {
    if (shape.kind !== "rect" || shape.width < frame.width * 0.05) continue;
    if (!vibrates(hue(shape.colour), saturation(shape.colour), hue(frame.background), saturation(frame.background))) continue;
    findings.push({
      severity: "note",
      frame: frame.index,
      code: "vibration",
      message: `${shape.colour} sits directly on ${frame.background}. Two saturated opposites make an edge the eye cannot settle on; a tint of either dissolves it.`,
      repairable: false,
    });
    break;
  }

  return findings;
}

/** What a block at this point is drawn on: a shape if one is under it, otherwise the surface. */
function backgroundUnder(frame: FrameSpec, x: number, y: number): string {
  const shape = frame.shapes.find((candidate) => candidate.kind === "rect" && x >= candidate.x && x < candidate.x + candidate.width && y >= candidate.y && y < candidate.y + candidate.height);
  if (shape) return shape.colour;
  if (frame.image) {
    // Over a dimmed photograph the worst case is the lightest the picture could be under the scrim.
    return frame.image.duotone?.from ?? "#000000";
  }
  return frame.background;
}

const clip = (value: string) => (value.length > 36 ? `${value.slice(0, 36)}…` : value);

/* ── Repair ───────────────────────────────────────────────────────────────────────────────── */

export type Repair = { frame: number; change: string };

/**
 * Change the brief so the next compose has no defects.
 *
 * Every repair is a smaller ask, never a cleverer layout: quieten the emphasis, shorten the text,
 * drop to a layout that needs less. That is deliberate — a repair that tries to be clever is a
 * second design system competing with the first, and the two will disagree.
 *
 * Returns a brief and the list of what it changed, so the studio can show "we shortened slide 3"
 * rather than silently producing different words from the ones somebody approved.
 */
export function repair(brief: CreativeBrief, findings: Finding[]): { brief: CreativeBrief; repairs: Repair[] } {
  const defects = findings.filter((finding) => finding.severity === "defect" && finding.repairable);
  if (!defects.length) return { brief, repairs: [] };

  const repairs: Repair[] = [];
  const frames = brief.frames.map((frame, index) => {
    const mine = defects.filter((finding) => finding.frame === index);
    if (!mine.length) return frame;
    let next = { ...frame };

    if (mine.some((finding) => finding.code === "overflow_bottom" || finding.code === "overflow_side")) {
      if (next.emphasis === "loud") {
        next = { ...next, emphasis: "normal" };
        repairs.push({ frame: index, change: "set one step quieter so the type fits" });
      } else if (next.body && next.body.length > 160) {
        next = { ...next, body: `${next.body.slice(0, 157).trimEnd()}…` };
        repairs.push({ frame: index, change: "shortened the body copy" });
      } else if (next.emphasis === "normal") {
        next = { ...next, emphasis: "quiet" };
        repairs.push({ frame: index, change: "set two steps quieter so the type fits" });
      } else if (next.items && next.items.length > 2) {
        next = { ...next, items: next.items.slice(0, 3) };
        repairs.push({ frame: index, change: "kept the first three items" });
      }
    }

    if (mine.some((finding) => finding.code === "missing_image")) {
      // A frame that wanted a photograph and has none becomes a frame that never wanted one, rather
      // than a frame with a hole in it.
      next = { ...next, layout: next.body ? "heading_body" : "statement", mediaId: undefined };
      repairs.push({ frame: index, change: "dropped the photograph it could not find" });
    }

    return next;
  });

  return { brief: { ...brief, frames }, repairs };
}

/** A one-line verdict for the studio's list. */
export function verdict(findings: Finding[]): { ok: boolean; summary: string } {
  const defects = findings.filter((finding) => finding.severity === "defect");
  const notes = findings.filter((finding) => finding.severity === "note");
  if (defects.length) return { ok: false, summary: `${defects.length} thing${defects.length === 1 ? "" : "s"} to fix` };
  if (notes.length) return { ok: true, summary: `${notes.length} suggestion${notes.length === 1 ? "" : "s"}` };
  return { ok: true, summary: "Ready to post" };
}
