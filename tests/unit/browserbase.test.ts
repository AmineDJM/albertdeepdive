import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Browserbase integration, without Browserbase.
 *
 * What is checked is the contract: the console's values become the right request, the answers
 * become the right words, and a missing key means the local browser rather than a failed render.
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
vi.mock("playwright", () => ({ chromium: { connectOverCDP: vi.fn(async () => ({ close: vi.fn() })) } }));

import { chromium } from "playwright";
import { testIntegration } from "@/server/integrations/service";
import { browserbaseConfig, connectBrowserbase, createBrowserbaseSession, sessionRequest } from "@/server/integrations/browserbase";

type Call = { url: string; init: RequestInit | undefined };

function answer(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

describe("Browserbase", () => {
  beforeEach(() => {
    stored.values = {};
    delete process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_PROJECT_ID;
    delete process.env.BROWSERBASE_REGION;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(chromium.connectOverCDP).mockClear();
  });

  it("is off until a key is saved, and then reads the project and region beside it", async () => {
    expect(await browserbaseConfig()).toBeNull();
    stored.values = { apiKey: "bb_test_1234", projectId: " proj-1 ", region: "" };
    expect(await browserbaseConfig()).toEqual({ apiKey: "bb_test_1234", projectId: "proj-1", region: undefined });
  });

  it("asks for a browser with the key in the header and only the options that were set", () => {
    const full = sessionRequest({ apiKey: "bb_test_1234", projectId: "proj-1", region: "eu-central-1" });
    expect(full.url).toBe("https://api.browserbase.com/v1/sessions");
    expect(full.init.method).toBe("POST");
    expect((full.init.headers as Record<string, string>)["x-bb-api-key"]).toBe("bb_test_1234");
    expect(JSON.parse(String(full.init.body))).toEqual({ timeout: 1800, projectId: "proj-1", region: "eu-central-1" });

    const bare = sessionRequest({ apiKey: "bb_test_1234" }, { timeoutSeconds: 120 });
    expect(JSON.parse(String(bare.init.body))).toEqual({ timeout: 120 });
  });

  it("turns a session into a connection, and a refusal into a sentence with the status in it", async () => {
    answer(201, { id: "sess-1", connectUrl: "wss://connect.browserbase.com?sessionId=sess-1" });
    await expect(createBrowserbaseSession({ apiKey: "bb_test_1234" })).resolves.toEqual({ id: "sess-1", connectUrl: "wss://connect.browserbase.com?sessionId=sess-1" });

    answer(402, { message: "Insufficient credits" });
    await expect(createBrowserbaseSession({ apiKey: "bb_test_1234" })).rejects.toThrow(/402.*Insufficient credits/);

    answer(201, { id: "sess-2" });
    await expect(createBrowserbaseSession({ apiKey: "bb_test_1234" })).rejects.toThrow(/without a connection URL/);
  });

  it("connects over CDP when configured, and stays out of the way when not", async () => {
    expect(await connectBrowserbase()).toBeNull();
    expect(chromium.connectOverCDP).not.toHaveBeenCalled();

    stored.values = { apiKey: "bb_test_1234", projectId: "proj-1" };
    const calls = answer(201, { id: "sess-1", connectUrl: "wss://connect.browserbase.com?sessionId=sess-1" });
    const browser = await connectBrowserbase();
    expect(browser).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ projectId: "proj-1" });
    expect(chromium.connectOverCDP).toHaveBeenCalledWith("wss://connect.browserbase.com?sessionId=sess-1", expect.objectContaining({ timeout: 30_000 }));
  });

  it("tests the key against the project list and says which project will render", async () => {
    expect(await testIntegration("browserbase")).toEqual({ ok: false, message: "No API key saved yet." });

    stored.values = { apiKey: "bb_test_1234", projectId: "proj-1" };
    const calls = answer(200, [{ id: "proj-1", name: "Briefly", concurrency: 3 }]);
    expect(await testIntegration("browserbase")).toEqual({ ok: true, message: "Connected. Renders will run in “Briefly”, up to 3 browsers at once." });
    expect(calls[0].url).toBe("https://api.browserbase.com/v1/projects");
    expect((calls[0].init?.headers as Record<string, string>)["x-bb-api-key"]).toBe("bb_test_1234");

    stored.values = { apiKey: "bb_test_1234", projectId: "proj-9" };
    answer(200, [{ id: "proj-1", name: "Briefly", concurrency: 3 }]);
    expect(await testIntegration("browserbase")).toEqual({ ok: false, message: "Connected, but this key cannot see project proj-9." });

    stored.values = { apiKey: "bb_test_bad" };
    answer(401, { message: "Unauthorized" });
    expect(await testIntegration("browserbase")).toEqual({ ok: false, message: "Browserbase rejected that key." });
  });

  it("reads the key from the environment first, where a host injects it", async () => {
    process.env.BROWSERBASE_API_KEY = "bb_env_5678";
    expect(await browserbaseConfig()).toEqual({ apiKey: "bb_env_5678", projectId: undefined, region: undefined });
  });
});
