import { ImageProviderError, nearestShape, type ImageProvider, type ImageRequest, type ImageResult } from "./types";

/**
 * OpenAI's image model: the precise editor.
 *
 * Its edit endpoint takes the current picture, the references and a mask, and keeps what the mask
 * covers — which is what a "replace only the plant" needs. Generation goes through the same model.
 */

export const OPENAI_IMAGE_MODEL = "gpt-image-1";
const SHAPES = [
  { size: "1536x1024", ratio: 1.5 },
  { size: "1024x1024", ratio: 1 },
  { size: "1024x1536", ratio: 1024 / 1536 },
];

export type OpenAiImageConfig = { apiKey: string | null; baseUrl?: string | null; centsPerImage?: number; fetch?: typeof globalThis.fetch };

export class OpenAiImageProvider implements ImageProvider {
  readonly name = "openai" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly proxyManaged: boolean;

  constructor(private readonly config: OpenAiImageConfig) {
    this.base = (config.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    // With no real key an egress proxy may inject credentials, exactly as the text provider assumes.
    this.proxyManaged = !config.apiKey || config.apiKey === "proxy" || config.apiKey === "proxy-injected";
  }

  async available() {
    return true;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.proxyManaged ? {} : { authorization: `Bearer ${this.config.apiKey}` }), ...extra };
  }

  private async fail(res: Response, doing: string): Promise<never> {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
    const detail = body.error?.message ?? "";
    if (res.status === 401) throw new ImageProviderError("OpenAI rejected the API key.", 401, false);
    if (res.status === 429) throw new ImageProviderError("OpenAI is busy; trying again shortly.", 429, true);
    if (res.status === 400 && /safety|moderation|policy/i.test(detail)) throw new ImageProviderError(`OpenAI declined this picture: ${detail}`, 400, false);
    throw new ImageProviderError(`OpenAI could not ${doing}${detail ? `: ${detail}` : ` (HTTP ${res.status}).`}`, res.status, res.status >= 500);
  }

  private result(payload: { data?: { b64_json?: string }[] }, model: string, requestId: string | null): ImageResult {
    const images = (payload.data ?? []).filter((entry) => entry.b64_json).map((entry) => ({ bytes: Buffer.from(entry.b64_json!, "base64"), mimeType: "image/png" }));
    if (!images.length) throw new ImageProviderError("OpenAI returned no picture.", 502, true);
    return { images, model, costCents: (this.config.centsPerImage ?? 4) * images.length, requestId };
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    const model = request.model || OPENAI_IMAGE_MODEL;
    // References on a generation are an edit in disguise: the model composes from them.
    if (request.references.length) return this.edit(request);
    const res = await this.fetchImpl(`${this.base}/images/generations`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ model, prompt: request.prompt, size: nearestShape(request.width, request.height, SHAPES), n: request.n }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) await this.fail(res, "make the picture");
    return this.result((await res.json()) as { data?: { b64_json?: string }[] }, model, res.headers.get("x-request-id"));
  }

  async edit(request: ImageRequest): Promise<ImageResult> {
    const model = request.model || OPENAI_IMAGE_MODEL;
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", request.prompt);
    form.set("n", String(request.n));
    form.set("size", nearestShape(request.width, request.height, SHAPES));
    // The picture being edited goes first: the endpoint treats the first image as the one to change
    // and the rest as material to draw on.
    const ordered = [...request.references].sort((a, b) => rank(a.role) - rank(b.role));
    for (const reference of ordered) form.append("image[]", new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType }), `${reference.role}.${reference.mimeType.includes("jpeg") ? "jpg" : "png"}`);
    if (request.mask) form.set("mask", new Blob([new Uint8Array(request.mask)], { type: "image/png" }), "mask.png");
    const res = await this.fetchImpl(`${this.base}/images/edits`, { method: "POST", headers: this.headers(), body: form, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) await this.fail(res, "edit the picture");
    return this.result((await res.json()) as { data?: { b64_json?: string }[] }, model, res.headers.get("x-request-id"));
  }
}

const ORDER = ["current_version", "original_master", "identity_reference", "product_reference", "brand_reference", "composition_reference", "style_reference"];
function rank(role: string) {
  const index = ORDER.indexOf(role);
  return index < 0 ? ORDER.length : index;
}
