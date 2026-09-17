import { createHash } from "node:crypto";
import { FORMATS, MODES, typeBox, type CreativeFormat, type CreativeMode } from "./formats";
import { designSystem, type DesignSystem } from "./design-systems";
import type { CreativeBrief, Emphasis, FrameBrief, FrameLayout, FrameSpec, ImageBlock, RenderSpec, ShapeBlock, TextBlock } from "./brief";
import { ensureContrast } from "@/lib/brand/colour";
import { FAMILIES } from "@/lib/brand/typography";
import type { BrandTokens, SurfaceKey } from "@/lib/brand/system";

/**
 * Brief plus brand, resolved into exactly what to draw.
 *
 * This is the function the whole architecture is arranged around. Above it a model decided what to
 * say and named a surface; below it a renderer draws rectangles and glyphs. Between them, here,
 * every remaining decision is made by arithmetic — which type step, how many lines, where the
 * baseline sits, what colour survives on that background — and none of it is a matter of taste at
 * render time, because the taste is in the constants.
 *
 * Three properties it must have, and the reasons:
 *
 *   Pure. No clock, no randomness, no network. The same brief and brand always give the same spec,
 *   so a pack can be re-rendered a year later and be identical rather than similar, and a golden
 *   test can assert on the whole thing.
 *
 *   Total. Any valid brief produces a drawable spec. There is no arrangement of headline lengths
 *   that yields text outside the frame, because copyfitting steps down the scale rather than
 *   letting the box overflow.
 *
 *   Contrast-safe. Every colour it emits has been through `ensureContrast` against the surface it
 *   will sit on. The brand system already guarantees this for its own tokens; this re-checks after
 *   compositing, because type over a dimmed photograph is a different background.
 */

/* ── Measurement ──────────────────────────────────────────────────────────────────────────── */

/**
 * How wide a string will be, without a browser.
 *
 * Real metrics need the font; an estimate needs only a table. These ratios are the average advance
 * width per character as a fraction of the em, measured once per family per weight, and they are
 * accurate to a few percent — which is enough, because the only question asked is "does this fit",
 * and the answer is used to pick a step from a scale, not to position a glyph.
 *
 * Being slightly pessimistic is deliberate: an estimate that runs narrow produces overflow, and an
 * estimate that runs wide produces one step smaller than necessary. Only one of those is visible.
 */
/**
 * Average advance width per character, as a fraction of the em, at weight 400 and at weight 700.
 *
 * Measured rather than guessed: a script sets each family at 100px in Chromium with the real woff2
 * loaded, measures five sample strings in both cases, and takes the *worst* ratio. Worst rather than
 * mean because the two errors are not symmetric — an estimate that runs narrow lets a headline run
 * off the frame, and one that runs wide picks a type step smaller than it had to. Only the first is
 * visible in the output.
 *
 * The first attempt at this table was eyeballed and was 35% low on bold Newsreader, which is exactly
 * the width of a headline that overshoots its box by a word and a half.
 */
const ADVANCE: Record<string, { regular: number; bold: number }> = {
  fraunces: { regular: 0.543, bold: 0.579 },
  newsreader: { regular: 0.619, bold: 0.672 },
  inter: { regular: 0.572, bold: 0.594 },
  plexMono: { regular: 0.719, bold: 0.719 },
};

/** Weight changes width; interpolating between the two measured points is close enough. */
function advanceFor(family: string, weight: number): number {
  const entry = ADVANCE[family] ?? ADVANCE.inter;
  const t = Math.max(0, Math.min(1, (weight - 400) / 300));
  return entry.regular + (entry.bold - entry.regular) * t;
}

/** Wider characters cost more than narrower ones; ignoring that misjudges all-caps badly. */
function measure(text: string, family: string, fontSize: number, tracking: number, uppercase: boolean, weight = 400): number {
  const base = advanceFor(family, weight);
  const source = uppercase ? text.toUpperCase() : text;
  let units = 0;
  for (const character of source) {
    if (character === " ") units += base * 0.42;
    else if ("iIlj|!.,:;'".includes(character)) units += base * 0.45;
    else if ("mMwW@".includes(character)) units += base * 1.42;
    else if (character >= "A" && character <= "Z") units += base * 1.14;
    else units += base;
  }
  return units * fontSize + Math.max(0, source.length - 1) * tracking * fontSize;
}

/** Greedy wrap, which is what every text renderer does, so the count matches what is drawn. */
export function wrapLines(text: string, maxWidth: number, family: string, fontSize: number, tracking: number, uppercase: boolean, weight = 400): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (measure(candidate, family, fontSize, tracking, uppercase, weight) <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * The largest step from the brand's scale at which this text fits the box.
 *
 * Steps, never a computed size. A layout that picks 41px because the headline nearly fitted is how a
 * page stops looking set and starts looking fitted, and the difference is visible across a carousel
 * where every slide has chosen its own size.
 */
function fitToBox(
  text: string,
  box: { width: number; height: number },
  scale: number[],
  role: { family: string; tracking: number; leading: number; uppercase: boolean; weight: number },
  maxSteps: { from: number; to: number },
): { fontSize: number; lines: string[] } {
  for (let index = maxSteps.from; index >= maxSteps.to; index -= 1) {
    const fontSize = scale[Math.max(0, Math.min(scale.length - 1, index))];
    const lines = wrapLines(text, box.width, role.family, fontSize, role.tracking, role.uppercase, role.weight);
    if (lines.length * fontSize * role.leading <= box.height) return { fontSize, lines };
  }
  // Nothing fits: take the smallest step and let the caller's box clip. Reached only by text far
  // longer than the schema allows, and better than an invisible zero.
  const fontSize = scale[Math.max(0, maxSteps.to)];
  return { fontSize, lines: wrapLines(text, box.width, role.family, fontSize, role.tracking, role.uppercase, role.weight) };
}

/* ── Emphasis ─────────────────────────────────────────────────────────────────────────────── */

/**
 * What "loud" means, in steps of the brand's own scale.
 *
 * The model says loud; this says "start at step 6 and copyfit down to step 4". Emphasis is relative
 * to the scale rather than absolute, so a brand with a dramatic ratio gets a dramatic loud and a
 * brand with an even one does not suddenly shout.
 */
const DISPLAY_STEPS: Record<Emphasis, { from: number; to: number }> = {
  quiet: { from: 4, to: 2 },
  normal: { from: 5, to: 3 },
  loud: { from: 6, to: 4 },
};

const clampStep = (step: number) => Math.max(0, Math.min(6, step));

const ANCHOR: Record<FrameLayout, "top" | "center" | "bottom"> = {
  statement: "bottom",
  quote: "bottom",
  cta: "bottom",
  image_full: "bottom",
  figure: "center",
  heading_body: "center",
  list: "center",
  image_top: "top",
};

const BODY_STEPS: Record<Emphasis, { from: number; to: number }> = {
  quiet: { from: 1, to: 0 },
  normal: { from: 2, to: 1 },
  loud: { from: 3, to: 1 },
};

/* ── Composition ──────────────────────────────────────────────────────────────────────────── */

type Ctx = {
  format: CreativeFormat;
  mode: CreativeMode;
  tokens: BrandTokens;
  box: { x: number; y: number; width: number; height: number };
  canvas: { width: number; height: number };
  /** The brand's ratio, re-anchored to this canvas. See `posterScale`. */
  scale: number[];
  system: DesignSystem;
  organizationName: string;
  total: number;
};

/**
 * A type scale for a poster, not for a page.
 *
 * The brand's own scale is anchored on a 16px body, because that is what reading text is. A social
 * frame is not read, it is glanced at on a phone held at arm's length while somebody scrolls, and
 * 64px on a 1080px canvas — the top of a document scale — is a caption there, not a headline.
 *
 * So the scale keeps the brand's ratio, which is the part that carries personality, and re-anchors
 * its base to the canvas: a 1080-wide frame gets a ~41px body and a ~165px display. The proportions
 * are the organisation's; the size is the medium's.
 */
function posterScale(width: number, ratio: number): number[] {
  const base = Math.round((width / 26) * 100) / 100;
  return Array.from({ length: 7 }, (_, i) => Math.round(base * ratio ** (i - 1) * 100) / 100);
}

const familyStack = (key: string) => FAMILIES[key as keyof typeof FAMILIES]?.stack ?? FAMILIES.inter.stack;

function block(
  role: TextBlock["role"],
  content: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  lines: number,
  style: { family: string; weight: number; tracking: number; leading: number; case: "none" | "upper" },
  colour: string,
  align: TextBlock["align"] = "left",
): TextBlock {
  return {
    role,
    content,
    x,
    y,
    width,
    fontSize,
    fontFamily: familyStack(style.family),
    fontWeight: style.weight,
    letterSpacing: style.tracking * fontSize,
    lineHeight: style.leading,
    colour,
    transform: style.case === "upper" ? "uppercase" : "none",
    align,
    lines,
  };
}

/**
 * One frame.
 *
 * Laid out from the bottom of the type box upward for the layouts that anchor low, and from the top
 * for the ones that read as a document. Both are deliberate: a statement sits on its baseline like
 * a poster, a heading-and-body reads like a page.
 */
function composeFrame(frame: FrameBrief, index: number, ctx: Ctx): FrameSpec {
  const { tokens, box, canvas } = ctx;
  const surface = tokens.surfaces[frame.surface as SurfaceKey] ?? tokens.surfaces.paper;
  const scale = ctx.scale;
  const shapes: ShapeBlock[] = [];
  const text: TextBlock[] = [];
  let image: ImageBlock | undefined;

  // A photograph changes the background under the type, so the colours are re-derived against what
  // the type will actually sit on rather than against the surface's nominal fill.
  const hasImage = frame.layout === "image_full" || frame.layout === "image_top";
  const overImage = frame.layout === "image_full";
  const effectiveBackground = overImage ? tokens.imagery.duotoneFrom : surface.background;
  const foreground = overImage ? ensureContrast(surface.background, effectiveBackground, 4.5) : surface.foreground;
  const subdued = overImage ? ensureContrast(foreground, effectiveBackground, 4.5) : surface.subdued;

  if (hasImage) {
    const imageHeight = overImage ? canvas.height : Math.round(canvas.height * 0.52);
    image = {
      mediaId: frame.mediaId ?? null,
      x: 0,
      y: 0,
      width: canvas.width,
      height: imageHeight,
      // Type over a photograph needs the photograph darkened; type beside one does not.
      dim: overImage ? Math.max(0.45, tokens.imagery.scrim) : 0,
      grain: tokens.imagery.grain,
      duotone: tokens.imagery.treatment === "duotone" ? { from: tokens.imagery.duotoneFrom, to: tokens.imagery.duotoneTo } : undefined,
    };
    if (MODES[ctx.mode].usesGeneratedImagery && !frame.mediaId) {
      image.generate = {
        treatment: tokens.imagery.treatment,
        palette: [tokens.surfaces.brand.background, tokens.surfaces.accent.background, tokens.surfaces.paper.background],
        // Abstract only. A generated picture never depicts a real event, a real place or a person.
        subject: tokens.imagery.treatment === "duotone" ? "gradient" : "texture",
      };
    }
  }

  const contentBox = frame.layout === "image_top" ? { ...box, y: Math.round(canvas.height * 0.52) + box.y, height: canvas.height - Math.round(canvas.height * 0.52) - box.y * 2 } : box;
  const displayStyle = { ...tokens.type.display, case: ctx.system.displayCase ?? tokens.type.display.case };
  const bodyStyle = tokens.type.text;
  const labelStyle = tokens.type.label;

  // The design system's furniture: an index chip, a bled numeral, a header and footer. It declares
  // the room it took, so the content below cannot collide with it.
  const chrome = ctx.system.chrome({
    format: ctx.format,
    canvas,
    box: contentBox,
    tokens,
    surface,
    index,
    total: ctx.total,
    organizationName: ctx.organizationName,
  });
  shapes.push(...chrome.shapes);
  for (const item of chrome.text) {
    text.push({ layer: "content", ...item, fontFamily: item.fontFamily ?? familyStack(item.role === "figure" ? tokens.type.figure.family : tokens.type.label.family) } as TextBlock);
  }

  const inner = {
    x: contentBox.x,
    y: contentBox.y + chrome.insetTop,
    width: contentBox.width,
    height: contentBox.height - chrome.insetTop - chrome.insetBottom,
  };

  const place = (options: { anchor: "top" | "center" | "bottom" }) => {
    const blocks: { fn: (y: number) => TextBlock[]; height: number }[] = [];

    const push = (make: (y: number) => TextBlock[], height: number) => blocks.push({ fn: make, height });
    const gap = tokens.shape.space[3];

    if (frame.layout === "figure" && frame.figure) {
      const fit = fitToBox(frame.figure, { width: inner.width, height: inner.height * 0.5 }, scale, { family: tokens.type.figure.family, tracking: tokens.type.figure.tracking, leading: tokens.type.figure.leading, uppercase: false, weight: tokens.type.figure.weight }, { from: 6, to: 4 });
      push((y) => [block("figure", frame.figure!, inner.x, y, inner.width, fit.fontSize, fit.lines.length, tokens.type.figure, surface.highlight)], fit.lines.length * fit.fontSize * tokens.type.figure.leading);
    }

    const bias = (steps: { from: number; to: number }) => ({ from: clampStep(steps.from + ctx.system.stepBias), to: clampStep(steps.to + ctx.system.stepBias) });
    const headlineSteps = bias(frame.layout === "figure" ? BODY_STEPS[frame.emphasis] : DISPLAY_STEPS[frame.emphasis]);
    const headlineStyle = frame.layout === "figure" ? bodyStyle : displayStyle;
    const headlineFit = fitToBox(
      frame.headline,
      { width: inner.width, height: inner.height * (frame.body || frame.items ? 0.5 : 0.85) },
      scale,
      { family: headlineStyle.family, tracking: headlineStyle.tracking, leading: headlineStyle.leading, uppercase: headlineStyle.case === "upper", weight: headlineStyle.weight },
      headlineSteps,
    );
    push(
      (y) => headlineFit.lines.map((line, lineIndex) => block(frame.layout === "figure" ? "text" : "display", line, inner.x, y + lineIndex * headlineFit.fontSize * headlineStyle.leading, inner.width, headlineFit.fontSize, 1, headlineStyle, foreground)),
      headlineFit.lines.length * headlineFit.fontSize * headlineStyle.leading + gap,
    );

    if (frame.body) {
      const fit = fitToBox(frame.body, { width: inner.width, height: inner.height * 0.45 }, scale, { family: bodyStyle.family, tracking: bodyStyle.tracking, leading: bodyStyle.leading, uppercase: false, weight: bodyStyle.weight }, bias(BODY_STEPS[frame.emphasis]));
      push(
        (y) => fit.lines.map((line, lineIndex) => block("text", line, inner.x, y + lineIndex * fit.fontSize * bodyStyle.leading, inner.width, fit.fontSize, 1, bodyStyle, subdued)),
        fit.lines.length * fit.fontSize * bodyStyle.leading + gap,
      );
    }

    if (frame.items?.length) {
      const fit = fitToBox(frame.items.reduce((longest, item) => (item.length > longest.length ? item : longest)), { width: inner.width - tokens.shape.space[4], height: inner.height / frame.items.length }, scale, { family: bodyStyle.family, tracking: bodyStyle.tracking, leading: bodyStyle.leading, uppercase: false, weight: bodyStyle.weight }, bias(BODY_STEPS[frame.emphasis]));
      // Each item is wrapped in its own right. Emitting the whole string as one block looks fine
      // until an item is a word too long, at which point `white-space: pre` runs it off the frame —
      // which is exactly what the poster system, with its wider measure, found.
      const itemWidth = inner.width - tokens.shape.space[4];
      const wrapped = frame.items.map((item) => wrapLines(item, itemWidth, bodyStyle.family, fit.fontSize, bodyStyle.tracking, false, bodyStyle.weight));
      const lineHeight = fit.fontSize * bodyStyle.leading;
      const totalHeight = wrapped.reduce((sum, lines) => sum + lines.length * lineHeight + tokens.shape.space[2], 0);

      push((y) => {
        const out: TextBlock[] = [];
        let cursor = y;
        wrapped.forEach((lines) => {
          shapes.push({ kind: "dot", x: inner.x, y: Math.round(cursor + fit.fontSize * 0.35), width: Math.round(fit.fontSize * 0.28), height: Math.round(fit.fontSize * 0.28), radius: 999, colour: surface.highlight });
          lines.forEach((line, lineIndex) => {
            out.push(block("text", line, inner.x + tokens.shape.space[4], cursor + lineIndex * lineHeight, itemWidth, fit.fontSize, 1, bodyStyle, foreground));
          });
          cursor += lines.length * lineHeight + tokens.shape.space[2];
        });
        return out;
      }, totalHeight + gap);
    }

    if (frame.attribution) {
      push((y) => [block("label", frame.attribution!, inner.x, y, inner.width, scale[1], 1, labelStyle, subdued)], scale[1] * labelStyle.leading + gap);
    }

    const total = blocks.reduce((sum, entry) => sum + entry.height, 0);
    const slack = Math.max(0, inner.height - total);
    let cursor = inner.y + (options.anchor === "top" ? 0 : options.anchor === "center" ? Math.round(slack / 2) : slack);
    for (const entry of blocks) {
      text.push(...entry.fn(cursor));
      cursor += entry.height;
    }
  };

  /**
   * Where the content sits in its box.
   *
   * Poster layouts anchor to the baseline, the way a poster does: the type grows upward from the
   * bottom and the space above it is the design. Document layouts centre, because a heading and two
   * sentences pinned to the top of a 1350px frame reads as a slide that failed to finish rather than
   * as one that chose to be quiet. Only `image_top` starts at the top, and only because its type has
   * a photograph directly above it.
   */
  place({ anchor: ANCHOR[frame.layout] });

  // A quote gets a rule above it rather than quotation marks, which are a different size in every
  // face and a different problem in every language.
  if (frame.layout === "quote") {
    shapes.unshift({ kind: "rule", x: inner.x, y: inner.y - tokens.shape.space[2], width: Math.round(inner.width * 0.22), height: Math.max(2, tokens.shape.borderWidth * 2), radius: 0, colour: surface.highlight });
  }

  return {
    index,
    layout: frame.layout,
    width: canvas.width,
    height: canvas.height,
    background: surface.background,
    image,
    shapes,
    text,
    alt: frame.alt ?? describeFrame(frame),
  };
}

/** Alt text when the Art Director did not write any. Describes the frame, not the design. */
function describeFrame(frame: FrameBrief): string {
  switch (frame.layout) {
    case "figure":
      return `${frame.figure ?? ""} — ${frame.headline}`.trim();
    case "quote":
      return `“${frame.headline}” — ${frame.attribution ?? "unattributed"}`;
    case "list":
      return `${frame.headline}: ${(frame.items ?? []).join("; ")}`;
    default:
      return frame.body ? `${frame.headline}. ${frame.body}` : frame.headline;
  }
}

/**
 * The whole pack.
 *
 * `fingerprint` is a hash of the resolved spec with the frames' own ordering, so it changes when
 * anything visible changes and does not when nothing does. The render worker uses it to skip work,
 * and the golden tests use it to notice that a refactor moved a pixel.
 */
export function composeSpec(brief: CreativeBrief, tokens: BrandTokens, options: { brandVersion: string; system?: string; organizationName?: string }): RenderSpec {
  const definition = FORMATS[brief.format];
  const system = designSystem(options.system);
  const base = typeBox(brief.format);
  const gutter = system.gutter * tokens.shape.space[3];
  const ctx: Ctx = {
    format: brief.format,
    mode: brief.mode,
    tokens,
    // A system may pull in or push out from the platform's safe area, but never past it in the
    // direction that matters: `Math.max(0, …)` keeps a bold system from bleeding type under
    // somebody else's interface.
    box: {
      x: Math.max(0, base.x + gutter),
      y: Math.max(0, base.y + gutter),
      width: base.width - gutter * 2,
      height: base.height - gutter * 2,
    },
    canvas: { width: definition.width, height: definition.height },
    scale: posterScale(definition.width, ratioOf(tokens)),
    system,
    organizationName: options.organizationName ?? "",
    total: Math.min(brief.frames.length, definition.maxFrames),
  };

  const frames = brief.frames.slice(0, definition.maxFrames).map((frame, index) => composeFrame(frame, index, ctx));

  const spec: Omit<RenderSpec, "fingerprint"> = {
    format: brief.format,
    mode: brief.mode,
    system: system.key,
    width: definition.width,
    height: definition.height,
    frames,
    caption: brief.caption,
    hashtags: brief.hashtags,
    brandVersion: options.brandVersion,
  };

  return { ...spec, fingerprint: fingerprintOf(spec) };
}

/**
 * The brand's own step ratio, recovered from its compiled scale.
 *
 * Compiling already applied the personality's ratio, so reading it back is exact and avoids passing
 * the raw BrandSystem down alongside its own compiled form — two sources for one number.
 */
function ratioOf(tokens: BrandTokens): number {
  const [a, b] = tokens.type.scale;
  return a > 0 ? b / a : 1.28;
}

export function fingerprintOf(spec: Omit<RenderSpec, "fingerprint">): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 32);
}

/**
 * Everything wrong with a composed spec, before a single pixel is drawn.
 *
 * Cheap to run and worth running on every compose: a frame whose text overflows its canvas, or whose
 * colour cannot be read on its own background, is a defect the renderer would faithfully reproduce.
 * Catching it here means the repair pass has something specific to fix.
 */
export function auditSpec(spec: RenderSpec): { frame: number; problem: string }[] {
  const problems: { frame: number; problem: string }[] = [];
  for (const frame of spec.frames) {
    for (const text of frame.text) {
      const bottom = text.y + text.lines * text.fontSize * text.lineHeight;
      if (bottom > frame.height) problems.push({ frame: frame.index, problem: `text "${text.content.slice(0, 32)}…" runs ${Math.round(bottom - frame.height)}px past the bottom` });
      if (text.x < 0 || text.x + text.width > frame.width) problems.push({ frame: frame.index, problem: `text "${text.content.slice(0, 32)}…" is outside the canvas horizontally` });
      if (text.fontSize <= 0) problems.push({ frame: frame.index, problem: "a text block has no size" });
    }
    if (!frame.text.length) problems.push({ frame: frame.index, problem: "the frame has no text at all" });
  }
  return problems;
}
