import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

/**
 * Higgsfield, without Higgsfield.
 *
 * The SDK is stood in for, so what is checked is ours: the console's credentials reach the client,
 * the model's answer is fitted to the frame, and every other answer is an error with the reason in it.
 */

const stored: { values: Record<string, string> } = { values: {} };

vi.mock("@/server/settings/secrets", () => ({
  readSecretSetting: vi.fn(async () => stored),
  writeSecretSetting: vi.fn(),
  open: (value: unknown) => value,
  seal: (value: unknown) => value,
  maskSecret: (value: string) => `…${value.slice(-4)}`,
}));
vi.mock("@/server/audit", () => ({ audit: vi.fn() }));

import { testIntegration } from "@/server/integrations/service";
import { higgsfieldImagery, setHiggsfieldClientFactoryForTests, type HiggsfieldResult, type ImageryDeps } from "@/server/creative/imagery";

const request = { treatment: "quiet", palette: ["#112233", "#445566", "#778899"], subject: "abstract" as const, width: 64, height: 32, key: "ground-1" };

async function picture() {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: "#ff0000" } }).png().toBuffer();
}

function deps(bytes: Buffer): ImageryDeps {
  return {
    fetch: vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch,
    renderHtml: vi.fn(async () => ({ bytes, mimeType: "image/png" })),
  };
}

describe("Higgsfield", () => {
  beforeEach(() => {
    stored.values = {};
    delete process.env.HF_CREDENTIALS;
    delete process.env.HIGGSFIELD_IMAGE_MODEL;
    delete process.env.HIGGSFIELD_BASE_URL;
  });
  afterEach(() => {
    setHiggsfieldClientFactoryForTests(null);
    vi.unstubAllGlobals();
  });

  it("is only available with a key-id:key-secret pair", async () => {
    expect(await higgsfieldImagery.available()).toBe(false);
    stored.values = { apiKey: "just-a-key" };
    expect(await higgsfieldImagery.available()).toBe(false);
    stored.values = { apiKey: "id:secret" };
    expect(await higgsfieldImagery.available()).toBe(true);
  });

  it("asks the model with the console's credentials and fits the answer to the frame", async () => {
    stored.values = { apiKey: "id:secret", imageModel: " my-org/my-model " };
    const seen: { config: unknown; model?: string; options?: unknown }[] = [];
    setHiggsfieldClientFactoryForTests((config) => {
      const call = { config };
      seen.push(call);
      return {
        subscribe: async (model, options) => {
          Object.assign(call, { model, options });
          return { status: "completed", request_id: "req-1", images: [{ url: "https://cdn.example/pic.png" }] } satisfies HiggsfieldResult;
        },
      };
    });
    const bytes = await picture();
    const result = await higgsfieldImagery.generate(request, deps(bytes));
    expect(seen[0].config).toMatchObject({ credentials: "id:secret" });
    expect(seen[0].model).toBe("my-org/my-model");
    expect(seen[0].options).toMatchObject({ withPolling: true, input: { prompt: expect.stringContaining("#112233") } });
    const meta = await sharp(result.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([64, 32]);
    expect(result).toMatchObject({ provider: "higgsfield", model: "my-org/my-model", credits: 1, mimeType: "image/png" });
  });

  it("reads the legacy answer shape too", async () => {
    stored.values = { apiKey: "id:secret" };
    setHiggsfieldClientFactoryForTests(() => ({ subscribe: async () => ({ status: "completed", jobs: [{ results: { raw: { url: "https://cdn.example/legacy.png" } } }] }) }));
    const result = await higgsfieldImagery.generate(request, deps(await picture()));
    expect(result.model).toBe("higgsfield-ai/soul/v2/standard");
  });

  it("never passes off a moderated, failed or empty answer as a picture", async () => {
    stored.values = { apiKey: "id:secret" };
    const d = deps(await picture());
    setHiggsfieldClientFactoryForTests(() => ({ subscribe: async () => ({ status: "nsfw" }) }));
    await expect(higgsfieldImagery.generate(request, d)).rejects.toThrow(/moderated/);
    setHiggsfieldClientFactoryForTests(() => ({ subscribe: async () => ({ status: "failed" }) }));
    await expect(higgsfieldImagery.generate(request, d)).rejects.toThrow(/"failed"/);
    setHiggsfieldClientFactoryForTests(() => ({ subscribe: async () => ({ status: "completed", images: [] }) }));
    await expect(higgsfieldImagery.generate(request, d)).rejects.toThrow(/no image/);
  });

  it("refuses to run on half a key", async () => {
    stored.values = { apiKey: "only-an-id" };
    await expect(higgsfieldImagery.generate(request, deps(await picture()))).rejects.toThrow(/key-id:key-secret/);
  });

  it("tests the credentials by asking after a request that cannot exist", async () => {
    expect(await testIntegration("higgsfield")).toEqual({ ok: false, message: "No credentials saved yet." });
    stored.values = { apiKey: "id:secret" };
    const calls: { url: string; init?: RequestInit }[] = [];
    const answer = (status: number) => vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status }); }));
    answer(404);
    expect(await testIntegration("higgsfield")).toEqual({ ok: true, message: "Connected. Pictures will come from higgsfield-ai/soul/v2/standard." });
    expect(calls[0].url).toBe("https://api.higgsfield.ai/requests/00000000-0000-0000-0000-000000000000/status");
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Key id:secret");
    answer(401);
    expect(await testIntegration("higgsfield")).toEqual({ ok: false, message: "Higgsfield rejected those credentials." });
    answer(403);
    expect((await testIntegration("higgsfield")).message).toMatch(/no credits/);
  });

  it("reads HF_CREDENTIALS from the environment, where Render holds it", async () => {
    process.env.HF_CREDENTIALS = "env-id:env-secret";
    expect(await higgsfieldImagery.available()).toBe(true);
  });
});
