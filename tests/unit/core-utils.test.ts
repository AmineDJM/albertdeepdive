import { describe, expect, it } from "vitest";
import { enumLabel, initials, slugify, truncate, wordCount } from "@/lib/utils";
import { countWords, paragraphsToBlocks, plainText } from "@/lib/publication/document";
import { defaultSectionForStoryType, storyTypeLabel, templateByCode } from "@/lib/constants";
import { renderTemplate } from "@/server/ai/run";
import { toStrictJsonSchema } from "@/server/ai/json-schema";
import { estimateCostCents } from "@/server/ai/pricing";
import { z } from "zod";

describe("utils", () => {
  it("slugifies accents and punctuation", () => {
    expect(slugify("Albert's Deep Dive — Special issue N°1 (May 2025)")).toBe(
      "albert-s-deep-dive-special-issue-n-1-may-2025",
    );
    expect(slugify("KÆRN: Théo & Colène")).toBe("kaern-theo-colene");
  });
  it("formats enums, initials and truncation", () => {
    expect(enumLabel("EDITORIAL_REVIEW")).toBe("Editorial review");
    expect(initials("Milan Viallet")).toBe("MV");
    expect(truncate("abcdefghij", 6)).toBe("abcde…");
    expect(wordCount("  one two   three ")).toBe(3);
  });
  it("converts paragraphs to blocks and back", () => {
    const blocks = paragraphsToBlocks("First para.\n\nSecond para here.", ["sub1"]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(countWords(blocks)).toBe(5);
    expect(plainText(blocks)).toContain("Second para here.");
  });
  it("maps story types to sections and templates", () => {
    expect(defaultSectionForStoryType("BUSINESS_DEEP_DIVE")).toBe("bdd");
    expect(defaultSectionForStoryType("UNKNOWN")).toBe("campus-life");
    expect(storyTypeLabel("ANECDOTE")).toBe("Anecdote");
    expect(templateByCode("BDD_CASE").imageSlots).toBe(2);
  });
});

describe("ai helpers", () => {
  it("renders template variables", () => {
    expect(
      renderTemplate("Hello {{name}} from {{campus}} ({{missing}})", {
        name: "Milan",
        campus: "Paris",
      }),
    ).toBe("Hello Milan from Paris (—)");
    expect(renderTemplate("{{list}}", { list: ["a", "b"] })).toBe("a, b");
  });
  it("builds strict JSON schemas for OpenAI structured outputs", () => {
    const schema = z.object({
      title: z.string().min(1),
      tags: z.array(z.string()),
      score: z.number().min(0).max(1).nullable(),
      nested: z.object({ ok: z.boolean() }),
    });
    const json = toStrictJsonSchema(schema) as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, Record<string, unknown>>;
    };
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(["title", "tags", "score", "nested"]);
    expect(json.properties.title.minLength).toBeUndefined();
    expect((json.properties.nested as { additionalProperties: boolean }).additionalProperties).toBe(
      false,
    );
  });
  it("estimates cost from the pricing table", () => {
    expect(estimateCostCents("gpt-4.1-mini", 1_000_000, 0)).toBeCloseTo(37, 0);
    expect(estimateCostCents("unknown-model", 1_000_000, 1_000_000)).toBeGreaterThan(0);
  });
});
