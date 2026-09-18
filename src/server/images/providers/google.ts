import { ImageProviderError, type ImageProvider, type ImageRequest, type ImageResult } from "./types";

/**
 * Google's image models (Nano Banana), through the Gemini API.
 *
 * One call for both making and editing: the prompt and every reference go in as parts of one
 * message, and the model answers with picture parts. It takes several references at once and
 * holds a person or a product steady across them, which is the job it is routed for.
 */

export const GOOGLE_IMAGE_MODEL = "gemini-3-pro-image-preview";

export type GoogleImageConfig = { apiKey: string; baseUrl?: string | null; centsPerImage?: number; fetch?: typeof globalThis.fetch };

type Part = { text?: string; inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string } };

export class GoogleImageProvider implements ImageProvider {
  readonly name = "google" as const;
  private readonly base: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: GoogleImageConfig) {
    this.base = (config.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  async available() {
    return Boolean(this.config.apiKey);
  }

  private async call(request: ImageRequest, model: string): Promise<ImageResult> {
    const parts: Part[] = [];
    for (const reference of request.references) {
      parts.push({ text: `Reference (${reference.role.replace(/_/g, " ")}):` });
      parts.push({ inline_data: { mime_type: reference.mimeType, data: reference.bytes.toString("base64") } });
    }
    parts.push({ text: request.prompt });
    const aspect = request.width === request.height ? "1:1" : request.width > request.height ? (request.width / request.height > 1.6 ? "16:9" : "4:3") : request.height / request.width > 1.6 ? "9:16" : "3:4";
    const images: ImageResult["images"] = [];
    let requestId: string | null = null;
    for (let index = 0; index < request.n; index += 1) {
      const res = await this.fetchImpl(`${this.base}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": this.config.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } } }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        if (res.status === 400 && /API key/i.test(body.error?.message ?? "")) throw new ImageProviderError("Google rejected the API key.", 401, false);
        if (res.status === 429) throw new ImageProviderError("Google is busy; trying again shortly.", 429, true);
        throw new ImageProviderError(`Google could not make the picture${body.error?.message ? `: ${body.error.message}` : ` (HTTP ${res.status}).`}`, res.status, res.status >= 500);
      }
      requestId = res.headers.get("x-request-id") ?? requestId;
      const data = (await res.json()) as { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
      if (data.promptFeedback?.blockReason) throw new ImageProviderError(`Google declined this picture: ${data.promptFeedback.blockReason}.`, 400, false);
      const found = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data || part.inline_data?.data);
      const inline = found?.inlineData ?? (found?.inline_data ? { mimeType: found.inline_data.mime_type, data: found.inline_data.data } : null);
      if (!inline) throw new ImageProviderError("Google returned no picture.", 502, true);
      images.push({ bytes: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || "image/png" });
    }
    return { images, model, costCents: (this.config.centsPerImage ?? 13) * images.length, requestId };
  }

  generate(request: ImageRequest) {
    return this.call(request, request.model || GOOGLE_IMAGE_MODEL);
  }

  edit(request: ImageRequest) {
    return this.call(request, request.model || GOOGLE_IMAGE_MODEL);
  }
}
