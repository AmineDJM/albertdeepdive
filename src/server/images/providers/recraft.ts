import { ImageProviderError, nearestShape, type ImageProvider, type ImageRequest, type ImageResult } from "./types";

/**
 * Recraft: illustration, icons and vector work.
 *
 * Asked for a vector, it answers with an SVG, which is what a brand's icon set and a reusable
 * illustration style should be. Photographs are never routed here.
 */

export const RECRAFT_MODEL = "recraftv3";
const SHAPES = [
  { size: "1820x1024", ratio: 1820 / 1024 },
  { size: "1365x1024", ratio: 1365 / 1024 },
  { size: "1024x1024", ratio: 1 },
  { size: "1024x1365", ratio: 1024 / 1365 },
  { size: "1024x1820", ratio: 1024 / 1820 },
];

export type RecraftConfig = { apiKey: string; baseUrl?: string | null; centsPerImage?: number; fetch?: typeof globalThis.fetch };

export class RecraftProvider implements ImageProvider {
  readonly name = "recraft" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: RecraftConfig) {
    this.base = (config.baseUrl || "https://external.api.recraft.ai/v1").replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async available() {
    return Boolean(this.config.apiKey);
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    const model = request.model || RECRAFT_MODEL;
    const style = request.output === "vector" ? "vector_illustration" : "digital_illustration";
    const res = await this.fetchImpl(`${this.base}/images/generations`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ prompt: request.prompt, model, style, size: nearestShape(request.width, request.height, SHAPES), n: request.n, response_format: "b64_json" }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.status === 401) throw new ImageProviderError("Recraft rejected the API key.", 401, false);
      throw new ImageProviderError(`Recraft could not make the picture${body.message || body.error ? `: ${body.message ?? body.error}` : ` (HTTP ${res.status}).`}`, res.status, res.status === 429 || res.status >= 500);
    }
    const data = (await res.json()) as { data?: { b64_json?: string; image_id?: string }[] };
    const images = (data.data ?? []).filter((entry) => entry.b64_json).map((entry) => {
      const bytes = Buffer.from(entry.b64_json!, "base64");
      const isSvg = bytes.subarray(0, 200).toString("utf8").includes("<svg");
      return { bytes, mimeType: isSvg ? "image/svg+xml" : "image/png" };
    });
    if (!images.length) throw new ImageProviderError("Recraft returned no picture.", 502, true);
    return { images, model, costCents: (this.config.centsPerImage ?? 4) * images.length, requestId: data.data?.[0]?.image_id ?? null };
  }
}
