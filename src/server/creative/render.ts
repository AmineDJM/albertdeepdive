import { createHash } from "node:crypto";
import type { Browser } from "playwright";
import sharp from "sharp";
import { launchBrowser, loadEmbeddedFontCss } from "@/server/publication/pdf";
import { renderContactSheetHtml, renderFrameHtml, type FrameImages } from "./render-html";
import type { FrameSpec, RenderSpec } from "@/lib/creative/brief";
import { createLogger } from "@/server/logger";

const log = createLogger("creative-render");

/**
 * Spec to pixels.
 *
 * The same Chromium the print pipeline uses, for the same reason: it is the only renderer that
 * agrees with itself about hinting, kerning and subpixel positioning across runs, and Briefly
 * already ships it. Fonts are embedded in the document rather than linked, so nothing is fetched and
 * nothing depends on a network that might be slow.
 *
 * JPEG for photographic frames and PNG for flat ones, chosen from the spec rather than configured: a
 * flat colour field re-encoded as JPEG picks up ringing along every letter edge, and a photograph
 * stored as PNG is four times the size for no visible gain.
 */

export type RenderedFrame = {
  index: number;
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
};

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function encodingFor(frame: FrameSpec): { mimeType: string; jpeg: boolean } {
  // A photograph or a generated field is continuous tone; everything else is flat colour and type.
  const photographic = Boolean(frame.image?.mediaId || frame.image?.generate);
  return photographic ? { mimeType: "image/jpeg", jpeg: true } : { mimeType: "image/png", jpeg: false };
}

/**
 * Render every frame of a spec.
 *
 * One browser, one context, one page reused across frames. Launching Chromium costs about a second
 * and rendering a frame costs about fifty milliseconds, so a page per frame would make a ten-slide
 * carousel ten times slower than it needs to be.
 *
 * `deviceScaleFactor` stays 1: the spec's numbers are the output's pixels. Rendering at 2× and
 * downsampling would be sharper on text and would also mean the composer's measurements no longer
 * describe the file, which is the property everything else here depends on.
 */
export async function renderSpec(
  spec: RenderSpec,
  options: { images?: FrameImages; browser?: Browser; onFrame?: (frame: RenderedFrame) => Promise<void> } = {},
): Promise<RenderedFrame[]> {
  const fontCss = await loadEmbeddedFontCss();
  const browser = options.browser ?? (await launchBrowser());
  const owned = !options.browser;

  try {
    const context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: 1,
      // A fixed locale and timezone so nothing in the document can render differently by accident.
      locale: "en-GB",
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const rendered: RenderedFrame[] = [];

    for (const frame of spec.frames) {
      const html = renderFrameHtml(frame, { fontCss, images: options.images });
      await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);

      const { mimeType, jpeg } = encodingFor(frame);
      const raw = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: frame.width, height: frame.height } });
      // mozjpeg at 88 is where the file stops shrinking and starts showing on type edges.
      const bytes = jpeg ? await sharp(raw).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer() : await sharp(raw).png({ compressionLevel: 9 }).toBuffer();

      const result: RenderedFrame = { index: frame.index, bytes, mimeType, width: frame.width, height: frame.height, sha256: sha(bytes) };
      rendered.push(result);
      if (options.onFrame) await options.onFrame(result);
    }

    await context.close();
    log.info("rendered", { frames: rendered.length, format: spec.format, fingerprint: spec.fingerprint });
    return rendered;
  } finally {
    if (owned) await browser.close().catch(() => {});
  }
}

/** One image of the whole set, for the studio's list and for a share preview. */
export async function renderContactSheet(spec: RenderSpec, options: { images?: FrameImages; browser?: Browser } = {}): Promise<RenderedFrame> {
  const fontCss = await loadEmbeddedFontCss();
  const browser = options.browser ?? (await launchBrowser());
  const owned = !options.browser;
  const scale = 0.25;
  const columns = Math.min(spec.frames.length, 5);
  const width = Math.round(spec.width * scale) * columns + 12 * (columns - 1) + 32;
  const rows = Math.ceil(spec.frames.length / columns);
  const height = Math.round(spec.height * scale) * rows + 12 * (rows - 1) + 32;

  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: "en-GB", timezoneId: "UTC" });
    const page = await context.newPage();
    await page.setContent(renderContactSheetHtml(spec, { fontCss, images: options.images, scale }), { waitUntil: "load", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const raw = await page.screenshot({ type: "png" });
    const bytes = await sharp(raw).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    await context.close();
    return { index: 0, bytes, mimeType: "image/jpeg", width, height, sha256: sha(bytes) };
  } finally {
    if (owned) await browser.close().catch(() => {});
  }
}
