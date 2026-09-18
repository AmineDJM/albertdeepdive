import sharp from "sharp";
import type { ImageProvider, ImageRequest, ImageResult } from "@/server/images/providers/types";

/**
 * A picture provider that draws instead of asking anyone.
 *
 * A generation is a gradient at the size asked; an edit is the picture to change (the current
 * version, or the master on a regeneration) with a coloured block painted over a corner — enough
 * for the perceptual hash to move a little, as a real localised edit's would, and for the file to
 * be a different one. Every request is kept so a test can read what the engine asked for. Set
 * `sameNext` and the next edit hands the picture back untouched, which is what a lazy model does
 * and what the checker must catch.
 */
export class FakeImageProvider implements ImageProvider {
  readonly name = "openai" as const;
  calls: ImageRequest[] = [];
  sameNext = 0;
  failNext: Error | null = null;
  counter = 0;

  async available() {
    return true;
  }

  private async block(base: Buffer, index: number): Promise<Buffer> {
    const meta = await sharp(base).metadata();
    const width = meta.width ?? 512;
    const height = meta.height ?? 512;
    const size = Math.max(8, Math.round(Math.min(width, height) * 0.3));
    // Six places on a grid, in turn: each edit paints somewhere new, so the hash moves every time.
    const slot = index % 6;
    const left = Math.min(width - size, Math.round((slot % 3) * (width - size) / 2));
    const top = Math.min(height - size, Math.round(Math.floor(slot / 3) * (height - size)));
    const colour = [
      { r: 220, g: 60, b: 40 },
      { r: 40, g: 160, b: 90 },
      { r: 30, g: 80, b: 200 },
      { r: 240, g: 200, b: 30 },
    ][index % 4];
    const patch = await sharp({ create: { width: size, height: size, channels: 4, background: { ...colour, alpha: 1 } } }).png().toBuffer();
    return sharp(base)
      .composite([{ input: patch, left: Math.max(0, left), top: Math.max(0, top) }])
      .png()
      .toBuffer();
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    this.calls.push(request);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    const images: ImageResult["images"] = [];
    for (let index = 0; index < request.n; index += 1) {
      this.counter += 1;
      const hue = (this.counter * 47) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,35%)"/><stop offset="1" stop-color="hsl(${(hue + 120) % 360},70%,75%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${30 + index * 20}%" cy="40%" r="18%" fill="hsl(${(hue + 200) % 360},80%,60%)"/></svg>`;
      images.push({ bytes: await sharp(Buffer.from(svg)).png().toBuffer(), mimeType: "image/png" });
    }
    return { images, model: request.model || "fake-image", costCents: 4 * images.length, requestId: `fake_${this.counter}` };
  }

  async edit(request: ImageRequest): Promise<ImageResult> {
    this.calls.push(request);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    const base = request.references.find((reference) => reference.role === "current_version") ?? request.references.find((reference) => reference.role === "original_master") ?? request.references[0];
    if (!base) throw new Error("The fake provider needs a picture to edit.");
    const images: ImageResult["images"] = [];
    for (let index = 0; index < request.n; index += 1) {
      this.counter += 1;
      if (this.sameNext > 0) {
        this.sameNext -= 1;
        images.push({ bytes: await sharp(base.bytes).png().toBuffer(), mimeType: "image/png" });
      } else images.push({ bytes: await this.block(base.bytes, this.counter), mimeType: "image/png" });
    }
    return { images, model: request.model || "fake-image", costCents: 4 * images.length, requestId: `fake_${this.counter}` };
  }
}
