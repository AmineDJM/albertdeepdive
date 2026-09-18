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
    // No picture yet, or none was wanted: a composed field from the brand's own palette, so a frame
    // waiting on a provider is still a designed frame rather than a grey box. The shape follows the
    // subject the composer asked for, because a gradient and a texture are not the same request.
    layers.push(`<div style="position:absolute;inset:0;${fieldCss(image.generate.palette, image.generate.subject)}"></div>`);
  } else {
    layers.push(`<div style="position:absolute;inset:0;background:${image.duotone?.from ?? "#000"}"></div>`);
  }

  if (image.dim > 0) {
    // A flat floor at the computed value, then a little extra toward the bottom for depth.
    //
    // The floor is the part that matters: the composer sized `dim` so that type clears 4.5:1 against
    // the lightest the picture can be, and a gradient that starts at half strength quietly hands back
    // half of that everywhere above the midpoint. The guarantee has to hold wherever type lands, not
    // wherever the layout happens to put it today.
    layers.push(`<div style="position:absolute;inset:0;background:rgba(0,0,0,${image.dim.toFixed(3)})"></div>`);
    const extra = Math.min(0.28, (1 - image.dim) * 0.45);
    if (extra > 0.01) {
      layers.push(`<div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,${extra.toFixed(3)}) 100%)"></div>`);
    }
  }
  if (image.grain > 0) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23g)' opacity='1'/></svg>`;
    layers.push(
      `<div style="position:absolute;inset:0;background-image:url(\\"data:image/svg+xml,${svg.replace(/"/g, "'").replace(/#/g, "%23")}\\");opacity:${(image.grain * 0.5).toFixed(3)};mix-blend-mode:overlay"></div>`,
    );
  }

  return `<div style="${frame}">${layers.join("")}</div>`;
}

/**
 * A field built from the brand's own three colours.
 *
 * This is what Briefly draws when no image provider is configured, and it is a real answer rather
 * than a placeholder: three brand colours, composited deterministically, is a legitimate abstract
 * ground for a poster and costs nothing. Cinematic mode therefore works out of the box, and adding a
 * provider later changes how good the picture is, not whether there is one.
 *
 * Each subject is a different composition, because "gradient", "texture" and "abstract" are three
 * different asks and rendering all three the same way makes the choice meaningless.
 */
export function fieldCss(palette: string[], subject: "abstract" | "texture" | "gradient"): string {
  const [a, b, c] = [palette[0] ?? "#111111", palette[1] ?? palette[0] ?? "#333333", palette[2] ?? palette[0] ?? "#666666"];
  if (subject === "gradient") return `background:linear-gradient(155deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
  if (subject === "texture") {
    // Overlapping soft radials read as depth rather than as a sweep; three of them at different
    // scales is the cheapest thing that stops a ground looking like a CSS gradient.
    return [
      `background-color:${a}`,
      `background-image:radial-gradient(70% 55% at 18% 12%, ${b} 0%, transparent 62%),`
        + `radial-gradient(55% 70% at 84% 28%, ${c} 0%, transparent 58%),`
        + `radial-gradient(90% 60% at 50% 100%, ${b} 0%, transparent 70%)`,
    ].join(";");
  }
  // Abstract: hard-edged bands at an angle, which is a composition rather than a wash.
  return `background:conic-gradient(from 210deg at 35% 30%, ${a} 0deg, ${b} 130deg, ${c} 240deg, ${a} 360deg)`;
}

export type FrameImages = Map<string, string>;

export function renderFrameHtml(frame: FrameSpec, options: { fontCss: string; images?: FrameImages }): string {
  // A frame's picture is either one of the organisation's own, looked up by media id, or a generated
  // one, looked up by the content-addressed key the composer put in the spec. Both arrive through the
  // same map, so the renderer never knows or cares which it got.
  const source = frame.image ? (frame.image.mediaId ?? frame.image.generate?.key ?? null) : null;
  const image = frame.image ? imageHtml(frame.image, source ? (options.images?.get(source) ?? null) : null) : "";
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
