import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { OpenAiImageProvider } from "@/server/images/providers/openai";
import { GoogleImageProvider } from "@/server/images/providers/google";
import { RecraftProvider } from "@/server/images/providers/recraft";
import { IdeogramProvider } from "@/server/images/providers/ideogram";
import { BrieflyImageProvider } from "@/server/images/providers/briefly";
import { ImageProviderError, nearestShape, type ImageRequest } from "@/server/images/providers/types";

/**
 * Each adapter speaks its service's language, and only that.
 *
 * The requests are checked shape by shape against a fake network: the editor gets the picture to
 * change first and the mask beside it; Google gets every reference inline with its role; Recraft
 * is asked for a vector when the plan wants one; Ideogram refuses an edit with no marked area.
 * None of them ever hands back a URL.
 */

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
type Call = { url: string; init: RequestInit };

function fake(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": "req_1" } });
const request = (extra: Partial<ImageRequest> = {}): ImageRequest => ({ model: "", prompt: "A calm sea.", width: 1536, height: 1024, references: [], mask: null, n: 1, output: "raster", ...extra });

describe("picture adapters", () => {
  it("picks the fixed shape that loses least", () => {
    const shapes = [{ size: "1536x1024", ratio: 1.5 }, { size: "1024x1024", ratio: 1 }, { size: "1024x1536", ratio: 1024 / 1536 }];
    expect(nearestShape(1600, 900, shapes)).toBe("1536x1024");
    expect(nearestShape(1080, 1920, shapes)).toBe("1024x1536");
    expect(nearestShape(1000, 1000, shapes)).toBe("1024x1024");
  });

  it("asks OpenAI for a generation as JSON and sends no key when the proxy holds it", async () => {
    const { calls, fetchImpl } = fake(() => json({ data: [{ b64_json: png.toString("base64") }] }));
    const provider = new OpenAiImageProvider({ apiKey: "proxy-injected", fetch: fetchImpl });
    const result = await provider.generate(request({ model: "gpt-image-1", n: 2 }));
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/generations");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ model: "gpt-image-1", prompt: "A calm sea.", size: "1536x1024", n: 2 });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(result.images[0].bytes.equals(png)).toBe(true);
    expect(result.costCents).toBe(4);
    expect(result.requestId).toBe("req_1");
  });

  it("sends OpenAI the picture to change first, the references after, and the mask beside them", async () => {
    const { calls, fetchImpl } = fake(() => json({ data: [{ b64_json: png.toString("base64") }] }));
    const provider = new OpenAiImageProvider({ apiKey: "sk-test", fetch: fetchImpl });
    await provider.edit(request({ references: [{ role: "product_reference", bytes: png, mimeType: "image/png" }, { role: "current_version", bytes: png, mimeType: "image/png" }, { role: "original_master", bytes: png, mimeType: "image/jpeg" }], mask: png }));
    expect(calls[0].url).toBe("https://api.openai.com/v1/images/edits");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const form = calls[0].init.body as FormData;
    expect(form.getAll("image[]").map((entry) => (entry as File).name)).toEqual(["current_version.png", "original_master.jpg", "product_reference.png"]);
    expect((form.get("mask") as File).name).toBe("mask.png");
    expect(form.get("size")).toBe("1536x1024");
  });

  it("turns OpenAI's refusals into plain, non-retryable errors", async () => {
    const { fetchImpl } = fake(() => json({ error: { message: "Your request was rejected by our safety system." } }, 400));
    const provider = new OpenAiImageProvider({ apiKey: "sk-test", fetch: fetchImpl });
    await expect(provider.generate(request())).rejects.toMatchObject({ name: "ImageProviderError", retryable: false, message: expect.stringMatching(/declined/) });
    const busy = new OpenAiImageProvider({ apiKey: "sk-test", fetch: fake(() => json({}, 429)).fetchImpl });
    await expect(busy.generate(request())).rejects.toMatchObject({ retryable: true, status: 429 });
  });

  it("hands Google every reference inline, with its role, and the shape as a ratio", async () => {
    const { calls, fetchImpl } = fake(() => json({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] }));
    const provider = new GoogleImageProvider({ apiKey: "g-key", fetch: fetchImpl });
    const result = await provider.edit(request({ model: "gemini-3-pro-image-preview", width: 1080, height: 1920, references: [{ role: "identity_reference", bytes: png, mimeType: "image/png" }] }));
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent");
    expect((calls[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.contents[0].parts.map((part: { text?: string; inline_data?: unknown }) => part.text ?? "image")).toEqual(["Reference (identity reference):", "image", "A calm sea."]);
    expect(body.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "9:16" } });
    expect(result.images[0].bytes.equals(png)).toBe(true);
    expect(result.costCents).toBe(13);
  });

  it("reports Google's block as a refusal, not a retry", async () => {
    const provider = new GoogleImageProvider({ apiKey: "g-key", fetch: fake(() => json({ promptFeedback: { blockReason: "SAFETY" } })).fetchImpl });
    await expect(provider.generate(request())).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/SAFETY/) });
  });

  it("asks Recraft for a vector when the plan wants one and recognises the SVG it returns", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#123"/></svg>');
    const { calls, fetchImpl } = fake(() => json({ data: [{ b64_json: svg.toString("base64"), image_id: "img_9" }] }));
    const provider = new RecraftProvider({ apiKey: "r-key", fetch: fetchImpl });
    const result = await provider.generate(request({ output: "vector", width: 1024, height: 1024 }));
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.style).toBe("vector_illustration");
    expect(body.size).toBe("1024x1024");
    expect(body.response_format).toBe("b64_json");
    expect(result.images[0].mimeType).toBe("image/svg+xml");
    expect(result.requestId).toBe("img_9");
  });

  it("gives Ideogram the picture and the mask as a form, and refuses to edit without a marked area", async () => {
    const { calls, fetchImpl } = fake((call) => (call.url.endsWith("/edit") ? json({ data: [{ url: "https://cdn.example/x.png" }] }) : new Response(png, { status: 200, headers: { "content-type": "image/png" } })));
    const provider = new IdeogramProvider({ apiKey: "i-key", fetch: fetchImpl });
    await expect(provider.edit(request({ references: [{ role: "current_version", bytes: png, mimeType: "image/png" }] }))).rejects.toBeInstanceOf(ImageProviderError);
    const result = await provider.edit(request({ model: "ideogram-v3", references: [{ role: "current_version", bytes: png, mimeType: "image/png" }], mask: png }));
    expect(calls[0].url).toMatch(/\/ideogram-v3\/edit$/);
    expect((calls[0].init.headers as Record<string, string>)["Api-Key"]).toBe("i-key");
    const form = calls[0].init.body as FormData;
    expect((form.get("image") as File).name).toBe("image.png");
    expect((form.get("mask") as File).name).toBe("mask.png");
    // The URL is fetched at once and only the bytes are kept.
    expect(calls[1].url).toBe("https://cdn.example/x.png");
    expect(result.images[0].bytes.equals(png)).toBe(true);
  });

  it("draws Briefly's own field at the size asked, from the brand's colours, for nothing", async () => {
    const provider = new BrieflyImageProvider();
    const result = await provider.generate(request({ width: 640, height: 360, n: 2, palette: ["#1F3A5F", "#C2603C", "nonsense"] }));
    expect(result.images).toHaveLength(2);
    expect(result.costCents).toBe(0);
    const meta = await sharp(result.images[0].bytes).metadata();
    expect([meta.width, meta.height]).toEqual([640, 360]);
    expect(result.images[0].bytes.equals(result.images[1].bytes)).toBe(false);
  });
});
