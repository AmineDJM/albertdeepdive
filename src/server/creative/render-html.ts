import type { FrameSpec, ImageBlock, RenderSpec, ShapeBlock, TextBlock } from "@/lib/creative/brief";

/**
 * A frame, as a self-contained HTML document.
 *
 * Absolute positions throughout, because the spec already decided them. There is no flow here and no
 * layout algorithm: every box has an x, a y and a width that arithmetic produced, and the browser's
 * only job is to draw glyphs into them. That is what makes the output reproducible — two runs of the
 * same spec cannot disagree about where a line broke, because the line breaks were decided upstream
 * and each one is its own element.
 *
 * Nothing is fetched. Fonts arrive as base64 in the CSS, images as data URIs. A renderer that
 * reaches the network produces a different picture when the network is slow, and a renderer that
 * fails because a CDN is down fails at the worst moment.
 */

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A style attribute, escaped.
 *
 * Font stacks contain double quotes — `"Fraunces", Georgia, serif` — and a raw one closes the
 * attribute, after which the browser reads the rest of the declaration as HTML attributes and
 * silently drops every property that followed. Everything still renders, at the default size in the
 * inherited colour, which is the worst kind of bug: it looks like a layout mistake rather than a
 * parsing one.
 */
const styleAttr = (declarations: string[]) => `style="${declarations.join(";").replace(/"/g, "&quot;")}"`;

function textHtml(block: TextBlock): string {
  const style = [
    "position:absolute",
    `left:${block.x}px`,
    `top:${block.y}px`,
    `width:${block.width}px`,
    `font-family:${block.fontFamily}`,
    `font-size:${block.fontSize}px`,
    `font-weight:${block.fontWeight}`,
    `letter-spacing:${block.letterSpacing.toFixed(3)}px`,
    `line-height:${block.lineHeight}`,
    `color:${block.colour}`,
    `text-transform:${block.transform}`,
    `text-align:${block.align}`,
    // Each block is one visual line, already wrapped by the composer. Letting the browser re-wrap
    // would reintroduce exactly the nondeterminism the composer exists to remove.
    "white-space:pre",
    "margin:0",
  ];
  return `<div ${styleAttr(style)}>${escape(block.content)}</div>`;
}

function shapeHtml(shape: ShapeBlock): string {
  const radius = shape.kind === "dot" ? "50%" : `${shape.radius}px`;
  return `<div style="position:absolute;left:${shape.x}px;top:${shape.y}px;width:${shape.width}px;height:${shape.height}px;border-radius:${radius};background:${shape.colour}"></div>`;
}

/**
 * A picture, its scrim and its grain, in that order.
 *
 * The grain is an inline SVG turbulence rather than a texture file: it is a few hundred bytes, it
 * scales to any canvas, and it is the cheapest thing that stops a flat render reading as synthetic.
 * A duotone is two stacked layers with `mix-blend-mode`, which Chromium composites identically every
 * time — an important property when the output is meant to be reproducible.
 */
function imageHtml(image: ImageBlock, dataUri: string | null): string {
  const frame = `position:absolute;left:${image.x}px;top:${image.y}px;width:${image.width}px;height:${image.height}px;overflow:hidden`;
  const layers: string[] = [];

  if (dataUri) {
    layers.push(`<div style="position:absolute;inset:0;background-image:url('${dataUri}');background-size:cover;background-position:center"></div>`);
    if (image.duotone) {
      layers.push(`<div style="position:absolute;inset:0;background:${image.duotone.from};mix-blend-mode:color"></div>`);
      layers.push(`<div style="position:absolute;inset:0;background:linear-gradient(160deg,${image.duotone.from},${image.duotone.to});mix-blend-mode:screen;opacity:0.35"></div>`);
    }
  } else if (image.generate) {
    // No picture yet: a composed field from the brand's own palette, so an un-generated frame is
    // still a designed frame rather than a grey box.
    const [a, b, c] = image.generate.palette;
    layers.push(`<div style="position:absolute;inset:0;background:radial-gradient(120% 90% at 20% 10%, ${a} 0%, ${b} 48%, ${c} 100%)"></div>`);
  } else {
    layers.push(`<div style="position:absolute;inset:0;background:${image.duotone?.from ?? "#000"}"></div>`);
  }

  if (image.dim > 0) {
    layers.push(`<div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,${(image.dim * 0.5).toFixed(3)}) 0%, rgba(0,0,0,${image.dim.toFixed(3)}) 100%)"></div>`);
  }
  if (image.grain > 0) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23g)' opacity='1'/></svg>`;
    layers.push(
      `<div style="position:absolute;inset:0;background-image:url(\\"data:image/svg+xml,${svg.replace(/"/g, "'").replace(/#/g, "%23")}\\");opacity:${(image.grain * 0.5).toFixed(3)};mix-blend-mode:overlay"></div>`,
    );
  }

  return `<div style="${frame}">${layers.join("")}</div>`;
}

export type FrameImages = Map<string, string>;

export function renderFrameHtml(frame: FrameSpec, options: { fontCss: string; images?: FrameImages }): string {
  const image = frame.image ? imageHtml(frame.image, frame.image.mediaId ? (options.images?.get(frame.image.mediaId) ?? null) : null) : "";
  // Background blocks first, then shapes, then content: a ghosted numeral is meant to be under the
  // headline, and draw order is the only thing that decides which of two overlapping blocks wins.
  const background = frame.text.filter((block) => block.layer === "background");
  const content = frame.text.filter((block) => block.layer !== "background");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${options.fontCss}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${frame.width}px;height:${frame.height}px;overflow:hidden}
body{-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal;font-variant-ligatures:common-ligatures}
.frame{position:relative;width:${frame.width}px;height:${frame.height}px;overflow:hidden;background:${frame.background}}
</style></head><body><div class="frame">${image}${background.map(textHtml).join("")}${frame.shapes.map(shapeHtml).join("")}${content.map(textHtml).join("")}</div></body></html>`;
}

/**
 * Every frame on one page, for the preview.
 *
 * Scaled down with a transform rather than re-composed at a smaller size, so what somebody approves
 * is exactly what gets rendered — a preview built by a second layout pass is a preview that can lie.
 */
export function renderContactSheetHtml(spec: RenderSpec, options: { fontCss: string; images?: FrameImages; scale?: number }): string {
  const scale = options.scale ?? 0.25;
  const frames = spec.frames
    .map((frame) => {
      const inner = renderFrameHtml(frame, options)
        .replace(/^[\s\S]*<body>/, "")
        .replace(/<\/body>[\s\S]*$/, "");
      // The frame's own stylesheet does not come with its markup, so two things it provided are
      // carried inline here: the background, and — more importantly — the positioning context. The
      // extracted `.frame` div has no rules, so without `position:relative` its absolutely-placed
      // children resolve against the page and every slide's type lands on its neighbour.
      return `<div style="width:${Math.round(frame.width * scale)}px;height:${Math.round(frame.height * scale)}px;overflow:hidden;border-radius:6px;background:${frame.background}"><div style="position:relative;width:${frame.width}px;height:${frame.height}px;overflow:hidden;transform:scale(${scale});transform-origin:top left">${inner}</div></div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${options.fontCss}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f4f4f5;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
</style></head><body>${frames}</body></html>`;
}
