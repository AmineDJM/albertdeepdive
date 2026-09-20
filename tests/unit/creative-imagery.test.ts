import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  brieflyImagery,
  generateImagery,
  googleImagery,
  higgsfieldImagery,
  IMAGERY_PROVIDERS,
  nearestSize,
  promptFor,
  seedFrom,
  setHiggsfieldClientFactoryForTests,
  type ImageryDeps,
  type ImageryProvider,
  type ImageryRequest,
} from "@/server/creative/imagery";
import { fieldCss } from "@/server/creative/render-html";
import { imageryKey } from "@/lib/creative/compose";

const REQUEST: ImageryRequest = {
  treatment: "duotone",
  palette: ["#10203A", "#2BAFE0", "#FFFFFF"],
  subject: "gradient",
  width: 1080,
  height: 1350,
  key: "abc123",
};

/** A renderer that returns bytes without a browser, so these tests need neither Chromium nor a network. */
const deps = (fetchImpl?: typeof globalThis.fetch): ImageryDeps => ({
  fetch: fetchImpl ?? (vi.fn() as unknown as typeof globalThis.fetch),
  renderHtml: async (html) => ({ bytes: Buffer.from(html), mimeType: "image/jpeg" }),
});

const provider = (name: ImageryProvider["name"], behaviour: Partial<ImageryProvider>): ImageryProvider => ({
  name,
  available: async () => true,
  generate: async () => ({ bytes: Buffer.from(name), mimeType: "image/png", provider: name, model: null, costCents: 1, credits: 1 }),
  ...behaviour,
});

describe("what an image model is told", () => {
  it("never carries editorial text, a name, a place or a date", () => {
    const prompt = promptFor({ ...REQUEST, subject: "abstract" });
    // The request is built from the palette and a closed set of three shapes. There is no path from a
    // headline to a prompt, which is what stops a generated picture becoming evidence of an event.
    for (const forbidden of ["Nadia", "Marseille", "2023", "Albert School", "headline", "students"]) {
      expect(prompt).not.toContain(forbidden);
    }
    expect(prompt).toContain("#10203A");
  });

  it("forbids lettering in every subject, because our type is drawn not generated", () => {
    for (const subject of ["abstract", "texture", "gradient"] as const) {
      const prompt = promptFor({ ...REQUEST, subject });
      expect(prompt.toLowerCase(), subject).toMatch(/no lettering/);
      expect(prompt.toLowerCase(), subject).toMatch(/no text|no lettering/);
    }
  });

  it("asks for no people and no recognisable places", () => {
    for (const subject of ["abstract", "texture", "gradient"] as const) {
      expect(promptFor({ ...REQUEST, subject }).toLowerCase(), subject).toMatch(/no recognisable places or people/);
    }
  });

  it("picks the shape that loses least of the picture to the crop", () => {
    expect(nearestSize(1080, 1080)).toBe("1024x1024");
    expect(nearestSize(1080, 1920)).toBe("1024x1536");
    expect(nearestSize(1920, 1080)).toBe("1536x1024");
    // A carousel is 4:5 = 0.8, and the boundary between square and portrait is the geometric mean,
    // √(2/3) ≈ 0.816. So portrait, which keeps 83% against a square's 80% — the kind of thing an
    // eyeballed threshold at 0.87 gets backwards.
    expect(nearestSize(1080, 1350)).toBe("1024x1536");
  });

  it("never loses more than it has to, for any canvas", () => {
    const ratios = { "1536x1024": 1.5, "1024x1024": 1, "1024x1536": 1024 / 1536 } as const;
    for (const [w, h] of [[1080, 1080], [1080, 1350], [1080, 1920], [1920, 1080], [1200, 630]]) {
      const target = w / h;
      const kept = (s: number) => Math.min(target / s, s / target);
      const chosen = kept(ratios[nearestSize(w, h) as keyof typeof ratios]);
      const best = Math.max(...Object.values(ratios).map(kept));
      expect(chosen, `${w}x${h}`).toBeCloseTo(best, 6);
    }
  });
});

describe("the route", () => {
  it("prefers the first available provider", async () => {
    const result = await generateImagery(REQUEST, {
      deps: deps(),
      providers: [provider("higgsfield", {}), provider("openai", {}), brieflyImagery],
    });
    expect(result.provider).toBe("higgsfield");
  });

  it("skips a provider that has no key", async () => {
    const result = await generateImagery(REQUEST, {
      deps: deps(),
      providers: [provider("higgsfield", { available: async () => false }), provider("openai", {}), brieflyImagery],
    });
    expect(result.provider).toBe("openai");
  });

  it("falls through a provider that throws, rather than failing the render", async () => {
    const result = await generateImagery(REQUEST, {
      deps: deps(),
      providers: [
        provider("higgsfield", { generate: async () => { throw new Error("502 from the provider"); } }),
        provider("openai", { generate: async () => { throw new Error("rate limited"); } }),
        brieflyImagery,
      ],
    });
    // Ours is last and cannot fail for want of a provider, so a frame always gets a ground.
    expect(result.provider).toBe("briefly");
    expect(result.costCents).toBe(0);
    expect(result.credits).toBe(0);
  });

  it("honours an allow-list even when a better provider is configured", async () => {
    const result = await generateImagery(REQUEST, {
      deps: deps(),
      allow: ["briefly"],
      providers: [provider("higgsfield", {}), provider("openai", {}), brieflyImagery],
    });
    expect(result.provider).toBe("briefly");
  });

  it("still returns a picture when the allow-list excludes everything", async () => {
    const result = await generateImagery(REQUEST, { deps: deps(), allow: [], providers: [provider("higgsfield", {})] });
    expect(result.provider).toBe("briefly");
  });

  it("draws a carousel with the model the whole product judges best at a realistic scene", () => {
    /*
     * Two bugs, one after the other, both invisible on screen.
     *
     * First the studio's chain had no Google in it at all, so a workspace with a Gemini key was
     * getting GPT Image behind its carousels and Nano Banana everywhere else — the same picture
     * from two different models depending on which screen asked. Then Higgsfield was connected and
     * went first, which quietly took the carousels off Nano Banana again.
     *
     * The order is a product decision and this is it: a frame behind a carousel is the "realistic
     * scene" job the image engine already routes to Nano Banana, so it leads here too. Higgsfield
     * is second and takes over when Google declines or is not connected.
     */
    const order = IMAGERY_PROVIDERS.map((each) => each.name);
    expect(order.indexOf("google")).toBe(0);
    expect(order.indexOf("higgsfield"), "the fallback, not the default").toBe(1);
    expect(order.indexOf("google")).toBeLessThan(order.indexOf("openai"));
    // And ours stays last, because a frame always gets a ground.
    expect(order[order.length - 1]).toBe("briefly");
  });
});

describe("Nano Banana", () => {
  const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#2BAFE0" } }).png().toBuffer();

  it("asks Gemini for the frame's own aspect and keeps the bytes it answers with", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const bytes = await png();
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: bytes.toString("base64") } }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;

    vi.doMock("@/server/integrations/service", () => ({ integrationConfig: async () => ({ apiKey: "AIza-test", imageModel: null, baseUrl: null }) }));
    const result = await googleImagery.generate(REQUEST, { ...deps(), fetch: fetchImpl });
    vi.doUnmock("@/server/integrations/service");

    expect(result.provider).toBe("google");
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("gemini-3-pro-image-preview:generateContent");
    // A carousel is 4:5, so the nearest shape Gemini offers is the portrait one.
    const config = calls[0].body.generationConfig as { imageConfig?: { aspectRatio?: string } };
    expect(config.imageConfig?.aspectRatio).toBe("3:4");
    // The prompt is the studio's, with its ban on lettering intact.
    const contents = calls[0].body.contents as { parts: { text?: string }[] }[];
    expect(contents[0].parts.at(-1)?.text).toBe(promptFor(REQUEST));
  });

  it("declines rather than pretending when no key is connected", async () => {
    vi.doMock("@/server/integrations/service", () => ({ integrationConfig: async () => ({ apiKey: null, imageModel: null, baseUrl: null }) }));
    await expect(googleImagery.available()).resolves.toBe(false);
    vi.doUnmock("@/server/integrations/service");
  });
});

describe("Higgsfield", () => {
  const picture = () => sharp({ create: { width: 8, height: 8, channels: 3, background: "#2BAFE0" } }).png().toBuffer();

  it("downloads the bytes rather than keeping the provider's URL, and fits them to the frame", async () => {
    const calls: string[] = [];
    const bytes = await picture();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } });
    });
    vi.doMock("@/server/integrations/service", () => ({ integrationConfig: async () => ({ apiKey: "id:secret", baseUrl: null, imageModel: null }) }));
    setHiggsfieldClientFactoryForTests(() => ({ subscribe: async () => ({ status: "completed", images: [{ url: "https://cdn.higgsfield.example/expires-in-an-hour.png" }] }) }));
    try {
      const result = await higgsfieldImagery.generate(REQUEST, deps(fetchImpl as unknown as typeof globalThis.fetch));
      // The model answers with a lease on somebody else's bucket; the one fetch is the download.
      expect(calls).toEqual(["https://cdn.higgsfield.example/expires-in-an-hour.png"]);
      const meta = await sharp(result.bytes).metadata();
      expect([meta.width, meta.height]).toEqual([REQUEST.width, REQUEST.height]);
      expect(result.provider).toBe("higgsfield");
      expect(result.credits).toBe(1);
    } finally {
      setHiggsfieldClientFactoryForTests(null);
    }
  });

  it("refuses credentials that are not the console's key-id:key-secret pair", async () => {
    vi.doMock("@/server/integrations/service", () => ({ integrationConfig: async () => ({ apiKey: "hf_test", baseUrl: null, imageModel: null }) }));
    await expect(higgsfieldImagery.generate(REQUEST, deps())).rejects.toThrow(/key-id:key-secret/);
  });

  it("seeds from the content-addressed key, so the same ask is reproducible at the provider too", () => {
    expect(seedFrom("abc123")).toBe(seedFrom("abc123"));
    expect(seedFrom("abc123")).not.toBe(seedFrom("abc124"));
    expect(Number.isInteger(seedFrom("abc123"))).toBe(true);
  });
});

describe("Briefly's own ground", () => {
  it("costs nothing and spends no credits", async () => {
    const result = await brieflyImagery.generate(REQUEST, deps());
    expect(result.costCents).toBe(0);
    expect(result.credits).toBe(0);
    expect(result.provider).toBe("briefly");
  });

  it("uses only the brand's own colours", async () => {
    const result = await brieflyImagery.generate(REQUEST, deps());
    const html = result.bytes.toString();
    for (const colour of REQUEST.palette) expect(html).toContain(colour);
    // And nothing else: no stock palette, no accent somebody liked.
    const hexes = new Set(html.match(/#[0-9A-Fa-f]{6}/g) ?? []);
    for (const hex of hexes) expect(REQUEST.palette.map((c) => c.toUpperCase())).toContain(hex.toUpperCase());
  });

  it("draws a different composition for each subject, so the choice means something", () => {
    const fields = (["abstract", "texture", "gradient"] as const).map((subject) => fieldCss(REQUEST.palette, subject));
    expect(new Set(fields).size).toBe(3);
    expect(fields[2]).toContain("linear-gradient");
    expect(fields[1]).toContain("radial-gradient");
    expect(fields[0]).toContain("conic-gradient");
  });

  it("survives a palette with fewer colours than it wanted", () => {
    expect(() => fieldCss(["#123456"], "texture")).not.toThrow();
    expect(fieldCss([], "gradient")).toContain("#");
  });
});

describe("content addressing", () => {
  it("gives the same name to the same ask and a different one to any change", () => {
    const base = { treatment: "duotone", palette: ["#000000", "#111111", "#222222"], subject: "gradient", width: 1080, height: 1350 };
    expect(imageryKey(base)).toBe(imageryKey({ ...base }));
    expect(imageryKey({ ...base, subject: "texture" })).not.toBe(imageryKey(base));
    expect(imageryKey({ ...base, palette: ["#000000", "#111111", "#333333"] })).not.toBe(imageryKey(base));
    expect(imageryKey({ ...base, height: 1920 })).not.toBe(imageryKey(base));
    // Short enough to be a filename, long enough not to collide.
    expect(imageryKey(base)).toMatch(/^[0-9a-f]{32}$/);
  });
});
