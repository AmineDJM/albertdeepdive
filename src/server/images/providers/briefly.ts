import sharp from "sharp";
import type { ImageProvider, ImageRequest, ImageResult } from "./types";

/**
 * Briefly's own generator: an abstract ground from the brand's colours, drawn here, free, always.
 *
 * The last link of every generation route, so a frame that needs a field gets one on a platform
 * with no provider connected. It never draws a thing, a place or a person, and it never edits.
 */
export class BrieflyImageProvider implements ImageProvider {
  readonly name = "briefly" as const;
  async available() {
    return true;
  }
  async generate(request: ImageRequest): Promise<ImageResult> {
    const palette = (request.palette?.length ? request.palette : ["#1F3A5F", "#C2603C", "#FCFCFB"]).map((colour) => (/^#[0-9a-f]{6}$/i.test(colour) ? colour : "#1F3A5F"));
    const images: ImageResult["images"] = [];
    for (let index = 0; index < request.n; index += 1) {
      const angle = 20 + index * 37 + ((request.seed ?? 0) % 90);
      const stops = palette.map((colour, position) => `<stop offset="${Math.round((position / Math.max(1, palette.length - 1)) * 100)}%" stop-color="${colour}"/>`).join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}"><defs><linearGradient id="g" gradientTransform="rotate(${angle})">${stops}</linearGradient><radialGradient id="r" cx="${30 + index * 15}%" cy="35%" r="70%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="100%" stop-color="#000000" stop-opacity="0.18"/></radialGradient><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.09"/></feComponentTransfer></filter></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
      images.push({ bytes: await sharp(Buffer.from(svg)).png().toBuffer(), mimeType: "image/png" });
    }
    return { images, model: "briefly-field", costCents: 0, requestId: null };
  }
}
