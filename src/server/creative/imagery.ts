import { createHash } from "node:crypto";
import sharp from "sharp";
import { fieldCss } from "./render-html";
import { createLogger } from "@/server/logger";

const log = createLogger("creative-imagery");

/**
 * Where a generated picture comes from.
 *
 * Three providers, tried in order, and the last one never fails. That ordering is the whole design:
 * Briefly's own renderer can always produce a legitimate abstract ground from the brand's three
 * colours, so Cinematic mode is not a feature that waits for an API key. Adding Higgsfield changes
 * how interesting the picture is, never whether there is one — which means an outage, a rate limit or
 * a lapsed key degrades the output instead of failing the render.
 *
 * Two rules the brief sets, enforced here rather than trusted to a prompt:
 *
 *   Nothing generated ever depicts a real event, a real place or a person. The request is built by
 *   the composer from the brand's palette and a subject from a closed set of three abstractions. No
 *   model is handed editorial text, a headline, a name or a date, so there is no path by which a
 *   picture could become documentary evidence of something that did not happen.
 *
 *   Nothing generated ever contains our typography. The words are drawn by the renderer, as real
 *   type, over whatever ground arrives. An image model is never asked for a finished slide.
 *
 * And one operational rule: a provider's result URL is downloaded to bytes before this function
 * returns. Those URLs expire, and a pack that renders today and 404s next month is not a pack.
 */

export type ImagerySubject = "abstract" | "texture" | "gradient";

export type ImageryRequest = {
  treatment: string;
  palette: string[];
  subject: ImagerySubject;
  width: number;
  height: number;
  /** The content-addressed name from the spec. Same ask, same name, same file. */
  key: string;
};

export type ImageryProviderName = "higgsfield" | "google" | "openai" | "briefly";

export type GeneratedImagery = {
  bytes: Buffer;
  mimeType: string;
  provider: ImageryProviderName;
  model: string | null;
  /** What it cost us, in cents. Briefly's own renderer is genuinely zero, and says so. */
  costCents: number;
  /** Credits are the customer-facing currency; in-house work spends none. */
  credits: number;
};

export type ImageryProvider = {
  name: ImageryProviderName;
  /** Whether this provider has what it needs right now. Checked per call: keys change in the console. */
  available: () => Promise<boolean>;
  generate: (request: ImageryRequest, deps: ImageryDeps) => Promise<GeneratedImagery>;
};

/**
 * Everything that touches the outside world, injected.
 *
 * Not for purity's sake — for testability. A provider that reaches for global `fetch` and a global
 * browser cannot be tested without a network and a Chromium, so it does not get tested, so it breaks
 * in a way nobody notices until a customer's render is a grey box.
 */
export type ImageryDeps = {
  fetch: typeof globalThis.fetch;
  /** Renders HTML to image bytes. Supplied by the caller so this module never launches a browser. */
  renderHtml: (html: string, size: { width: number; height: number }) => Promise<{ bytes: Buffer; mimeType: string }>;
};

/* ── Prompts ──────────────────────────────────────────────────────────────────────────────── */

/**
 * What an image model is told, built entirely from the request.
 *
 * Deliberately narrow and deliberately not editorial: colours and a shape language, nothing else. A
 * prompt assembled from a headline is a prompt that can produce a picture of a thing that never
 * happened, and there is no amount of "photorealistic" worth that.
 */
export function promptFor(request: ImageryRequest): string {
  const colours = request.palette.filter(Boolean).join(", ");
  const shape =
    request.subject === "gradient"
      ? "a smooth continuous gradient field, no objects, no horizon, no subject"
      : request.subject === "texture"
        ? "an abstract close-up texture — paper grain, fine noise, soft depth — no objects, no people, no text"
        : "a flat geometric abstract composition of overlapping planes, no objects, no people, no text";
  return `${shape}. Colours strictly limited to ${colours}. No lettering, no numerals, no logos, no watermarks, no recognisable places or people. Editorial art direction, restrained, printable.`;
}

/* ── Briefly's own ────────────────────────────────────────────────────────────────────────── */

/**
 * The picture we draw ourselves.
 *
 * The same `fieldCss` the renderer falls back to, rendered once to a file so it becomes a real asset:
 * cacheable, shareable, and identical on every future render because the CSS is derived from the
 * brand and nothing else. Grain is added here rather than left to the frame, so the stored picture
 * looks like a picture on its own.
 */
export const brieflyImagery: ImageryProvider = {
  name: "briefly",
  available: async () => true,
  generate: async (request, deps) => {
    const grain = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23g)'/></svg>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${request.width}px;height:${request.height}px;overflow:hidden}
.f{position:absolute;inset:0;${fieldCss(request.palette, request.subject)}}
.g{position:absolute;inset:0;background-image:url("data:image/svg+xml,${grain.replace(/"/g, "'").replace(/#/g, "%23")}");opacity:0.10;mix-blend-mode:overlay}
</style></head><body><div class="f"></div><div class="g"></div></body></html>`;
    const rendered = await deps.renderHtml(html, { width: request.width, height: request.height });
    return { ...rendered, provider: "briefly", model: null, costCents: 0, credits: 0 };
  },
};

/* ── Higgsfield ───────────────────────────────────────────────────────────────────────────── */

/** What a Higgsfield image costs us, per picture. Kept here so the ledger and the plan agree. */
export const HIGGSFIELD_IMAGE_CENTS = 4;
export const HIGGSFIELD_DEFAULT_IMAGE_MODEL = "higgsfield-ai/soul/v2/standard";

/** What the SDK resolves to, wide enough for both shapes its API has answered with. */
export type HiggsfieldResult = { status: string; request_id?: string; images?: { url: string }[]; jobs?: ({ results?: { raw?: { url?: string } } | null } | null)[] };

export type HiggsfieldClient = { subscribe: (model: string, options: { input: Record<string, unknown>; withPolling?: boolean }) => Promise<HiggsfieldResult> };
export type HiggsfieldClientFactory = (config: { credentials: string; baseURL?: string; maxPollTime?: number }) => HiggsfieldClient;

/** A stand-in for the SDK, for tests that must not reach Higgsfield. Null means the real one. */
let higgsfieldFactory: HiggsfieldClientFactory | null = null;
export function setHiggsfieldClientFactoryForTests(factory: HiggsfieldClientFactory | null) {
  higgsfieldFactory = factory;
}

export async function higgsfieldClient(config: { credentials: string; baseURL?: string; maxPollTime?: number }): Promise<HiggsfieldClient> {
  if (higgsfieldFactory) return higgsfieldFactory(config);
  const { createHiggsfieldClient } = await import("@higgsfield/client/v2");
  return createHiggsfieldClient(config) as unknown as HiggsfieldClient;
}

/**
 * Higgsfield, through its own SDK.
 *
 * The credentials are the console's "key-id:key-secret" pair, read from the integration (or
 * HF_CREDENTIALS). The model is asked for a picture with polling and nothing else: the prompt is
 * the composer's, the size is ours — whatever the model draws is fitted to the frame here, so the
 * spec's numbers stay the file's numbers. A request that ends any way but "completed" is an
 * error with that word in it, never a blank ground passed off as a picture.
 */
export const higgsfieldImagery: ImageryProvider = {
  name: "higgsfield",
  available: async () => {
    const { integrationConfig } = await import("@/server/integrations/service");
    const config = await integrationConfig("higgsfield");
    return Boolean(config.apiKey && config.apiKey.includes(":"));
  },
  generate: async (request, deps) => {
    const { integrationConfig } = await import("@/server/integrations/service");
    const config = await integrationConfig("higgsfield");
    const credentials = config.apiKey?.trim();
    if (!credentials) throw new Error("Higgsfield has no credentials configured.");
    if (!credentials.includes(":")) throw new Error("Higgsfield credentials must be key-id:key-secret.");
    const model = config.imageModel?.trim() || HIGGSFIELD_DEFAULT_IMAGE_MODEL;
    const baseURL = config.baseUrl?.trim().replace(/\/+$/, "");

    const client = await higgsfieldClient({ credentials, ...(baseURL ? { baseURL } : {}), maxPollTime: 5 * 60 * 1000 });
    const result = await client.subscribe(model, { input: { prompt: promptFor(request) }, withPolling: true });
    const status = String(result?.status ?? "");
    if (status !== "completed") {
      throw new Error(status === "nsfw" ? "Higgsfield moderated the request and produced no picture." : `Higgsfield ended the request as "${status || "unknown"}" without a picture.`);
    }
    const url = result.images?.[0]?.url ?? result.jobs?.[0]?.results?.raw?.url;
    if (!url) throw new Error("Higgsfield returned no image.");

    // Bytes, always. A result URL is a lease on somebody else's bucket, and a pack that renders today
    // and 404s next month has not been rendered. Fitted to the frame: the model draws at its own size.
    const raw = await download(url, deps);
    const bytes = await sharp(raw).resize(request.width, request.height, { fit: "cover" }).png().toBuffer();
    return { bytes, mimeType: "image/png", provider: "higgsfield", model, costCents: HIGGSFIELD_IMAGE_CENTS, credits: 1 };
  },
};

/* ── OpenAI images ────────────────────────────────────────────────────────────────────────── */

/** What one gpt-image-1 picture costs us at the sizes we ask for. */
export const OPENAI_IMAGE_CENTS = 4;

/** What a Nano Banana picture costs, in whole cents, at the model's published rate. */
export const GOOGLE_IMAGE_CENTS = 13;

/**
 * Google's Nano Banana, for the grounds the studio draws its frames on.
 *
 * The image engine next door already routes this model first for a realistic scene. The studio's
 * own chain did not have it at all, so a workspace with a Gemini key connected was getting GPT
 * Image — or a drawn field — behind its carousels while the rest of the product used Nano Banana
 * for exactly the same kind of picture. Same key, same model id, same aspect the studio asks for;
 * the only reason this is a separate adapter is that the two chains were written for different
 * jobs and neither should grow a dependency on the other.
 */
export const googleImagery: ImageryProvider = {
  name: "google",
  available: async () => {
    const { integrationConfig } = await import("@/server/integrations/service");
    const config = await integrationConfig("google");
    return Boolean(config.apiKey);
  },
  generate: async (request, deps) => {
    const { integrationConfig } = await import("@/server/integrations/service");
    const { GoogleImageProvider, GOOGLE_IMAGE_MODEL } = await import("@/server/images/providers/google");
    const config = await integrationConfig("google");
    const apiKey = config.apiKey ?? "";
    if (!apiKey) throw new Error("No Gemini API key is configured.");

    const provider = new GoogleImageProvider({ apiKey, baseUrl: config.baseUrl, fetch: deps.fetch });
    const result = await provider.generate({
      prompt: promptFor(request),
      // A ground is invented rather than derived: there is nothing of the workspace's to hold steady.
      references: [],
      width: request.width,
      height: request.height,
      n: 1,
      model: config.imageModel?.trim() || GOOGLE_IMAGE_MODEL,
      output: "raster",
    });
    const first = result.images[0];
    if (!first) throw new Error("Google returned no picture.");
    return { bytes: first.bytes, mimeType: first.mimeType || "image/png", provider: "google", model: result.model, costCents: result.costCents || GOOGLE_IMAGE_CENTS, credits: 1 };
  },
};

export const openAiImagery: ImageryProvider = {
  name: "openai",
  available: async () => {
    const { integrationConfig } = await import("@/server/integrations/service");
    const { env } = await import("@/server/env");
    const config = await integrationConfig("openai");
    return Boolean(config.apiKey ?? env.OPENAI_API_KEY);
  },
  generate: async (request, deps) => {
    const { integrationConfig } = await import("@/server/integrations/service");
    const { env } = await import("@/server/env");
    const config = await integrationConfig("openai");
    const apiKey = config.apiKey ?? env.OPENAI_API_KEY;
    const baseUrl = (config.baseUrl || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    // With no real key an egress proxy may inject credentials, exactly as the text provider assumes.
    const proxyManaged = !apiKey || apiKey === "proxy" || apiKey === "proxy-injected";

    const response = await deps.fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(proxyManaged ? {} : { authorization: `Bearer ${apiKey}` }) },
      body: JSON.stringify({ model: "gpt-image-1", prompt: promptFor(request), size: nearestSize(request.width, request.height), n: 1 }),
    });
    if (!response.ok) throw new Error(`OpenAI images returned ${response.status} ${response.statusText}`);

    const payload = (await response.json()) as { data?: { url?: string; b64_json?: string }[] };
    const first = payload.data?.[0];
    if (!first) throw new Error("OpenAI returned no image.");
    const bytes = first.b64_json ? Buffer.from(first.b64_json, "base64") : await download(first.url, deps);
    return { bytes, mimeType: "image/png", provider: "openai", model: "gpt-image-1", costCents: OPENAI_IMAGE_CENTS, credits: 1 };
  },
};

/* ── The route ────────────────────────────────────────────────────────────────────────────── */

/**
 * Best first, ours last.
 *
 * Order is a product decision rather than a technical one, and it is the same decision the image
 * engine next door already made: Nano Banana draws a realistic scene better than the alternatives,
 * so it goes first here too rather than only in the Library. A frame behind a carousel is exactly
 * the "realistic scene" job that routing names.
 *
 * It is not the cheapest order — Nano Banana is 13¢ against Higgsfield's 4¢ — and that is the
 * trade being made on purpose: a carousel is six frames somebody posts under their own name, and
 * three cents is the wrong thing to optimise there. Higgsfield stays second and takes over the
 * moment Google declines, is out of credits, or is not connected at all; a customer with only an
 * OpenAI key still gets something; and everybody gets a designed ground in the worst case.
 */
export const IMAGERY_PROVIDERS: ImageryProvider[] = [googleImagery, higgsfieldImagery, openAiImagery, brieflyImagery];

export type ImageryOptions = {
  deps: ImageryDeps;
  /** Restrict the route — Super Admin can hold a workspace to in-house imagery whatever keys exist. */
  allow?: ImageryProviderName[];
  providers?: ImageryProvider[];
};

/**
 * Produce the picture, falling forward through whatever is configured.
 *
 * A provider that throws is logged and skipped rather than propagated: the point of a route is that
 * one link breaking does not break the chain. Only a failure of Briefly's own renderer can fail this
 * function, and that means Chromium is gone, which is a real problem worth surfacing.
 */
export async function generateImagery(request: ImageryRequest, options: ImageryOptions): Promise<GeneratedImagery> {
  const candidates = (options.providers ?? IMAGERY_PROVIDERS).filter((provider) => !options.allow || options.allow.includes(provider.name));
  const usable = candidates.length ? candidates : [brieflyImagery];

  for (const provider of usable) {
    const last = provider === usable[usable.length - 1];
    try {
      if (!(await provider.available())) continue;
      return await provider.generate(request, options.deps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (last) throw error;
      log.warn("imagery provider failed, falling through", { provider: provider.name, error: message });
    }
  }

  // Every candidate declined. Ours never does, so this is only reachable when the allow-list excluded
  // it — and a frame still needs a ground.
  return brieflyImagery.generate(request, options.deps);
}

/* ── Helpers ──────────────────────────────────────────────────────────────────────────────── */

async function download(url: string | undefined, deps: ImageryDeps): Promise<Buffer> {
  if (!url) throw new Error("The provider returned neither bytes nor a URL.");
  const response = await deps.fetch(url);
  if (!response.ok) throw new Error(`Could not download the generated image: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** A stable numeric seed from the content-addressed key, so the provider is reproducible too. */
export function seedFrom(key: string): number {
  return parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16);
}

/**
 * The size to ask an image API for, chosen to lose the least of the picture.
 *
 * The APIs offer three shapes — landscape, square and portrait — and our canvases are none of them
 * (a carousel is 4:5, a story 9:16). Whatever arrives is drawn with `cover`, so the question is only
 * which source loses least to the crop, and that has an exact answer: covering a target of ratio `r`
 * from a source of ratio `s` keeps `min(r/s, s/r)`, so two candidates crop equally at the geometric
 * mean of their ratios, and the boundary belongs there rather than at a round number somebody liked.
 *
 * For 4:5 that puts the boundary at √(2/3) ≈ 0.816, below the 0.8 a carousel actually is — so a
 * carousel asks for portrait, which loses 17% rather than the 20% a square would.
 */
const API_SHAPES = [
  { size: "1536x1024", ratio: 1536 / 1024 },
  { size: "1024x1024", ratio: 1 },
  { size: "1024x1536", ratio: 1024 / 1536 },
] as const;

export function nearestSize(width: number, height: number): string {
  const ratio = width / height;
  // What fraction of the source survives the crop. Higher is better; the best is exact, not binned.
  const kept = (candidate: number) => Math.min(ratio / candidate, candidate / ratio);
  return API_SHAPES.reduce((best, shape) => (kept(shape.ratio) > kept(best.ratio) ? shape : best)).size;
}
