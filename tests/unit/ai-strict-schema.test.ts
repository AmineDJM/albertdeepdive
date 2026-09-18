import { describe, expect, it } from "vitest";
import { z } from "zod";
import { scrubEmpties, toStrictJsonSchema } from "@/server/ai/json-schema";
import { creativeBriefSchema } from "@/lib/creative/brief";

/**
 * What a strict-mode model is told, and what it is allowed to send back.
 *
 * Found by making one real call. The conversion required every property and widened none, so the
 * model had to emit *something* for each optional field, emitted empty strings, and failed zod on
 * every attempt. The Art Director had never succeeded against a real model; every production pack
 * was the local fallback, silently.
 */
describe("strict json schema", () => {
  const schema = z.object({
    headline: z.string().min(1),
    body: z.string().min(1).optional(),
    items: z.array(z.string()).min(2).optional(),
    tags: z.array(z.string()),
    nested: z.object({ note: z.string().optional() }).optional(),
  });

  it("keeps every property required, as strict mode demands", () => {
    const json = toStrictJsonSchema(schema) as { required: string[]; additionalProperties: boolean };
    expect(json.required.sort()).toEqual(["body", "headline", "items", "nested", "tags"]);
    expect(json.additionalProperties).toBe(false);
  });

  it("widens an optional property to admit null, and leaves a required one alone", () => {
    const json = toStrictJsonSchema(schema) as { properties: Record<string, { anyOf?: { type?: string }[]; type?: string }> };
    expect(json.properties.body.anyOf?.some((m) => m.type === "null")).toBe(true);
    expect(json.properties.items.anyOf?.some((m) => m.type === "null")).toBe(true);
    expect(json.properties.headline.anyOf).toBeUndefined();
    expect(json.properties.headline.type).toBe("string");
    // Optional inside optional, too.
    const nested = json.properties.nested.anyOf?.find((m) => m.type === "object") as { properties: Record<string, { anyOf?: unknown[] }> } | undefined;
    expect(nested?.properties.note.anyOf).toBeTruthy();
  });

  it("does the same for the brief the Art Director actually writes", () => {
    const json = toStrictJsonSchema(creativeBriefSchema) as { properties: { frames: { items: { properties: Record<string, { anyOf?: { type?: string }[] }> } } } };
    const frame = json.properties.frames.items.properties;
    for (const optional of ["body", "figure", "attribution", "items", "mediaId", "alt"]) {
      expect(frame[optional].anyOf?.some((m) => m.type === "null"), optional).toBe(true);
    }
    expect(frame.headline.anyOf).toBeUndefined();
  });
});

describe("scrubbing a model's answer", () => {
  const schema = z.object({
    headline: z.string().min(1),
    body: z.string().min(1).optional(),
    items: z.array(z.string()).min(2).optional(),
    tags: z.array(z.string()),
    frames: z.array(z.object({ title: z.string(), alt: z.string().optional() })),
  });

  it("drops an optional field the model filled with nothing", () => {
    const scrubbed = scrubEmpties(schema, { headline: "A", body: "", items: [], tags: [], frames: [{ title: "t", alt: null }] });
    expect(scrubbed).toEqual({ headline: "A", tags: [], frames: [{ title: "t" }] });
    expect(schema.safeParse(scrubbed).success).toBe(true);
  });

  it("leaves a required field alone, empty or not", () => {
    // A legitimately empty required array survives; a required empty string still fails on its own terms.
    const scrubbed = scrubEmpties(schema, { headline: "", tags: [], frames: [] });
    expect(scrubbed).toEqual({ headline: "", tags: [], frames: [] });
    const result = schema.safeParse(scrubbed);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["headline"]);
  });

  it("makes the exact answer a real model gave parse", () => {
    // Trimmed from the first real call: every optional sent as "" or [], mediaId as "".
    const answer = {
      format: "CAROUSEL",
      mode: "STUDIO",
      intent: "Show the work.",
      frames: [
        { layout: "statement", headline: "The alum turning satellite images into crop forecasts", body: "", figure: "", attribution: "", items: [], surface: "brand", emphasis: "loud", mediaId: "", alt: "" },
        { layout: "cta", headline: "Read the whole thing", body: "", figure: "", attribution: "", items: [], surface: "accent", emphasis: "normal", mediaId: "", alt: "" },
      ],
      caption: "A caption.",
      hashtags: [],
    };
    expect(creativeBriefSchema.safeParse(answer).success).toBe(false);
    expect(creativeBriefSchema.safeParse(scrubEmpties(creativeBriefSchema, answer)).success).toBe(true);
  });
});
