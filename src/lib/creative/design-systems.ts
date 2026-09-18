import { ensureContrast } from "@/lib/brand/colour";
import type { BrandTokens, SurfaceTokens } from "@/lib/brand/system";
import type { CreativeFormat } from "./formats";
import type { ShapeBlock, TextBlock } from "./brief";

/**
 * Three ways to set the same brand.
 *
 * A design system here is not a theme and not a colour scheme — the colours, the typefaces and the
 * proportions all still come from the organisation's Brand DNA, and two customers using the same
 * system look nothing like each other. What a system decides is *composition*: how much air there
 * is, where the eye enters the frame, what furniture the frame carries, whether the type is set like
 * a magazine, a poster or a report.
 *
 * Three rather than thirty, because a system is only a system if somebody maintained it. Each of
 * these has a job it is genuinely better at, and the studio names that job rather than the style:
 *
 *   Editorial — a story with a shape. Restrained, baseline-anchored, lots of air.
 *   Poster    — one idea, loud. Type to the edges, the index as part of the composition.
 *   Report    — a structured set. A header band, a footer, a visible column, thin rules.
 *
 * Each returns chrome (the furniture) and the inset it costs. The composer lays the content out in
 * what is left, which is why a system cannot accidentally overlap its own content: it declares the
 * room it took.
 */

export const DESIGN_SYSTEMS = ["editorial", "poster", "report"] as const;
export type DesignSystemKey = (typeof DESIGN_SYSTEMS)[number];

export type ChromeInput = {
  format: CreativeFormat;
  canvas: { width: number; height: number };
  box: { x: number; y: number; width: number; height: number };
  tokens: BrandTokens;
  surface: SurfaceTokens;
  index: number;
  total: number;
  /** Set on the frames where the organisation should sign its name. */
  organizationName: string;
};

/** A chrome block may leave the family to the composer, which knows which role maps to which face. */
export type ChromeText = Omit<TextBlock, "fontFamily"> & { fontFamily?: string };

export type Chrome = {
  shapes: ShapeBlock[];
  text: ChromeText[];
  /** Room the chrome took at the top and bottom of the content box. */
  insetTop: number;
  insetBottom: number;
};

export type DesignSystem = {
  key: DesignSystemKey;
  name: string;
  description: string;
  /** Extra inset inside the format's safe area, as a multiple of the brand's spacing unit. */
  gutter: number;
  /**
   * How many steps louder or quieter than the brief asked for.
   *
   * A poster runs a step hotter than an editorial page at the same nominal emphasis, which is what
   * "poster" means. The brief is unchanged; the system interprets it.
   */
  stepBias: number;
  /** A system may overrule the brand's display case — a poster often wants caps where a page does not. */
  displayCase?: "none" | "upper";
  /** Whether body copy is set at all, or the system is headline-only. */
  chrome: (input: ChromeInput) => Chrome;
};

const empty = (): Chrome => ({ shapes: [], text: [], insetTop: 0, insetBottom: 0 });

/**
 * Editorial.
 *
 * A small index chip and nothing else. The design is the air: type anchored low, wide margins, and a
 * frame that trusts the words to hold it. This is the one that looks most like something a person
 * laid out, and the one that suffers least from a weak headline.
 */
const editorial: DesignSystem = {
  key: "editorial",
  name: "Editorial",
  description: "A story with a shape. Restrained, plenty of air, type that sits on its baseline like a page.",
  gutter: 0,
  stepBias: 0,
  chrome: ({ box, canvas, tokens, surface, index, format }) => {
    if (format === "SQUARE_POST") return empty();
    // Sized from the canvas rather than from the spacing unit: a chip whose numeral lands below the
    // legible minimum is a chip nobody reads, and the spacing unit knows nothing about how large the
    // canvas is.
    const labelSize = Math.max(minLegible(canvas.width), Math.round(canvas.width * 0.026));
    const height = Math.round(labelSize * 2.1);
    return {
      shapes: [{ kind: "rect", x: box.x, y: box.y, width: height * 2, height, radius: tokens.shape.radiusSm, colour: surface.highlight }],
      text: [
        {
          role: "label",
          content: String(index + 1),
          x: box.x,
          y: box.y + Math.round((height - labelSize * 1.2) / 2),
          width: height * 2,
          fontSize: labelSize,
          fontWeight: tokens.type.label.weight,
          letterSpacing: 0,
          lineHeight: 1.2,
          // Checked against the chip it sits on, not assumed from the surface. The brand guarantees
          // its highlight is readable at large-text contrast; a numeral at label size is not large
          // text, and white-on-highlight came out at 3:1 until this was measured rather than assumed.
          colour: ensureContrast(surface.background, surface.highlight, 4.5),
          transform: "none",
          align: "center",
          lines: 1,
        },
      ],
      insetTop: height + tokens.shape.space[4],
      insetBottom: 0,
    };
  },
};

/**
 * Poster.
 *
 * The index becomes a composition element rather than a label: a large numeral in the corner, set in
 * the highlight at low opacity so it reads as texture rather than as information. Type runs a step
 * hotter and closer to the edges. Made for one idea said loudly, and unforgiving of three.
 */
const poster: DesignSystem = {
  key: "poster",
  name: "Poster",
  description: "One idea, loud. Type to the edges and a numeral that is part of the picture.",
  gutter: -1,
  stepBias: 1,
  chrome: ({ box, canvas, tokens, surface, index, total, format }) => {
    if (format === "SQUARE_POST" || total < 2) return empty();
    const size = Math.round(canvas.width * 0.26);
    return {
      shapes: [],
      text: [
        {
          role: "figure",
          content: String(index + 1).padStart(2, "0"),
          // Bottom-right, bled toward the corner: it anchors the frame without competing for the
          // reading position, which is top-left. The box spans the full measure rather than the
          // numeral's nominal size — a right-aligned box narrower than its own glyphs overflows to
          // the right, which puts the digits off the frame.
          x: box.x,
          y: canvas.height - box.y - Math.round(size * 0.82),
          width: canvas.width - box.x * 2,
          fontSize: size,
          fontWeight: tokens.type.figure.weight,
          letterSpacing: tokens.type.figure.tracking * size,
          lineHeight: 0.82,
          // Mixed 82% into the background: present, never legible enough to be read as a word, and
          // marked as texture so the type it sits behind is drawn over it rather than beside it.
          colour: mix(surface.foreground, surface.background, 0.82),
          layer: "background",
          transform: "none",
          align: "right",
          lines: 1,
        },
      ],
      insetTop: 0,
      insetBottom: Math.round(size * 0.35),
    };
  },
};

/**
 * Report.
 *
 * A header band with the organisation's name and a footer with the position in the set. The content
 * column is visibly bounded by rules, which is what makes a sequence of ten slides read as one
 * document rather than ten pictures. Institutional in the good sense: it looks like it was issued.
 */
const report: DesignSystem = {
  key: "report",
  name: "Report",
  description: "A structured set. A header, a footer and a visible column — ten slides that read as one document.",
  gutter: 1,
  stepBias: -1,
  chrome: ({ box, canvas, tokens, surface, index, total, organizationName }) => {
    const labelSize = Math.max(minLegible(canvas.width), Math.round(canvas.width * 0.021));
    // Anchored to the content box, not mirrored from its top inset. A Story's safe area is 250px at
    // the top and 320px at the bottom, so a footer placed at `canvas.height - box.y` lands 70px
    // inside Instagram's own caption block — legible in the file, sat on by somebody else's UI in
    // the feed. The box already knows where the safe area ends; ask it rather than assume symmetry.
    const boxBottom = box.y + box.height;
    const bandTop = box.y + labelSize * 2;
    const bandBottom = boxBottom - labelSize * 2;
    const rule = Math.max(1, tokens.shape.borderWidth);

    return {
      shapes: [
        { kind: "rule", x: box.x, y: bandTop, width: box.width, height: rule, radius: 0, colour: surface.rule },
        { kind: "rule", x: box.x, y: bandBottom, width: box.width, height: rule, radius: 0, colour: surface.rule },
      ],
      text: [
        {
          role: "label",
          content: organizationName,
          x: box.x,
          y: box.y,
          width: box.width,
          fontSize: labelSize,
          fontWeight: tokens.type.label.weight,
          letterSpacing: tokens.type.label.tracking * labelSize,
          lineHeight: 1.2,
          colour: surface.subdued,
          transform: "uppercase",
          align: "left",
          lines: 1,
        },
        {
          role: "label",
          content: `${index + 1} / ${total}`,
          x: box.x,
          y: boxBottom - labelSize * 1.2,
          width: box.width,
          fontSize: labelSize,
          fontWeight: tokens.type.label.weight,
          letterSpacing: tokens.type.label.tracking * labelSize,
          lineHeight: 1.2,
          colour: surface.subdued,
          transform: "none",
          align: "right",
          lines: 1,
        },
      ],
      insetTop: bandTop - box.y + tokens.shape.space[5],
      insetBottom: boxBottom - bandBottom + tokens.shape.space[4],
    };
  },
};

export const SYSTEMS: Record<DesignSystemKey, DesignSystem> = { editorial, poster, report };

export function designSystem(key: string | null | undefined): DesignSystem {
  return SYSTEMS[(key ?? "") as DesignSystemKey] ?? editorial;
}

/** The smallest type that is read rather than seen, on this canvas. Kept in step with the laws. */
function minLegible(canvasWidth: number): number {
  return Math.ceil((11 * canvasWidth) / 390);
}

/** Mixing toward a background, for the ghosted numeral. Contrast checks use the brand's own engine. */
function mix(a: string, b: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const [x, y] = [parse(a), parse(b)];
  const t = Math.max(0, Math.min(1, amount));
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
