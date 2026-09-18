import { download, ImageProviderError, type ImageProvider, type ImageRequest, type ImageResult } from "./types";

/**
 * Ideogram: posters, campaign graphics, compositions where lettering is part of the art.
 *
 * The final words are still set by Briefly's renderer; what this model is asked for is the
 * artwork around them, with placeholder shapes where type will go.
 */

export const IDEOGRAM_MODEL = "ideogram-v3";
const RATIOS = [
  { size: "16x9", ratio: 16 / 9 },
  { size: "3x2", ratio: 1.5 },
  { size: "4x3", ratio: 4 / 3 },
  { size: "1x1", ratio: 1 },
  { size: "3x4", ratio: 3 / 4 },
  { size: "2x3", ratio: 2 / 3 },
  { size: "9x16", ratio: 9 / 16 },
];

export type IdeogramConfig = { apiKey: string; baseUrl?: string | null; centsPerImage?: number; fetch?: typeof globalThis.fetch };

export class IdeogramProvider implements ImageProvider {
  readonly name = "ideogram" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: IdeogramConfig) {
    this.base = (config.baseUrl || "https://api.ideogram.ai/v1").replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async available() {
    return Boolean(this.config.apiKey);
  }

  private async collect(res: Response, model: string, doing: string): Promise<ImageResult> {
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.status === 401) throw new ImageProviderError("Ideogram rejected the API key.", 401, false);
      throw new ImageProviderError(`Ideogram could not ${doing}${body.message || body.error ? `: ${body.message ?? body.error}` : ` (HTTP ${res.status}).`}`, res.status, res.status === 429 || res.status >= 500);
    }
    const data = (await res.json()) as { data?: { url?: string }[] };
    const urls = (data.data ?? []).map((entry) => entry.url).filter((url): url is string => Boolean(url));
    if (!urls.length) throw new ImageProviderError("Ideogram returned no picture.", 502, true);
    const images = await Promise.all(urls.map((url) => download(url, this.fetchImpl)));
    return { images, model, costCents: (this.config.centsPerImage ?? 6) * images.length, requestId: res.headers.get("x-request-id") };
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    const model = request.model || IDEOGRAM_MODEL;
    const form = new FormData();
    form.set("prompt", request.prompt);
    form.set("aspect_ratio", RATIOS.reduce((best, shape) => (Math.abs(shape.ratio - request.width / request.height) < Math.abs(best.ratio - request.width / request.height) ? shape : best)).size);
    form.set("num_images", String(request.n));
    form.set("rendering_speed", "DEFAULT");
    const res = await this.fetchImpl(`${this.base}/${model}/generate`, { method: "POST", headers: { "Api-Key": this.config.apiKey }, body: form, signal: AbortSignal.timeout(180_000) });
    return this.collect(res, model, "make the picture");
  }

  async edit(request: ImageRequest): Promise<ImageResult> {
    const model = request.model || IDEOGRAM_MODEL;
    const current = request.references.find((reference) => reference.role === "current_version") ?? request.references[0];
    if (!current) throw new ImageProviderError("Ideogram needs the picture to edit.", 400, false);
    if (!request.mask) throw new ImageProviderError("Ideogram edits need a marked area.", 400, false);
    const form = new FormData();
    form.set("image", new Blob([new Uint8Array(current.bytes)], { type: current.mimeType }), "image.png");
    form.set("mask", new Blob([new Uint8Array(request.mask)], { type: "image/png" }), "mask.png");
    form.set("prompt", request.prompt);
    form.set("num_images", String(request.n));
    form.set("rendering_speed", "DEFAULT");
    const res = await this.fetchImpl(`${this.base}/${model}/edit`, { method: "POST", headers: { "Api-Key": this.config.apiKey }, body: form, signal: AbortSignal.timeout(180_000) });
    return this.collect(res, model, "edit the picture");
  }
}
