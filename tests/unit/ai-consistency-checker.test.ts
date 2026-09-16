import { describe, expect, it } from "vitest";
import { generateLocal } from "@/server/ai/providers/local-generators";
import { consistencySchema, factSheetSchema, normalizerSchema } from "@/server/ai/services";
import type { ProviderRequest } from "@/server/ai/types";
import { BDD_STORIES } from "../../seed/stories-bdd";

const req = (service: string, input: Record<string, unknown>): ProviderRequest => ({ system: "", user: "", model: "local-deterministic", temperature: 0, maxOutputTokens: 0, schema: {}, schemaName: service, hints: { service, input } });
const carrefour = BDD_STORIES.find((s) => s.key === "bdd-carrefour-b2")!;

const subs = carrefour.submissions.map((sub, i) => {
  const out = normalizerSchema.parse(generateLocal(req("normalizer", { storyType: sub.storyType, campus: "Paris", title: sub.title, description: sub.description, peopleInvolved: sub.peopleInvolved ?? "", organisationsInvolved: sub.organisationsInvolved ?? "", quotes: sub.quotes ?? "", extra: sub.extra ?? {} })));
  return { id: `sub${i}`, title: sub.title, text: out.normalizedText, storyType: sub.storyType, contributor: null, quotes: sub.quotes ?? null };
});
const sheet = factSheetSchema.parse(generateLocal(req("fact_sheet", { submissionList: subs })));
const factList = sheet.facts.filter((f) => f.confidence !== "CONFLICTING").map((f, i) => ({ id: `f${i}`, statement: f.statement }));
const quoteList = sheet.quotes.map((q, i) => ({ id: `q${i}`, text: q.text, speaker: q.speakerName }));

function check(blocks: Record<string, unknown>[]) {
  return consistencySchema.parse(generateLocal(req("consistency_checker", { factList, quoteList, blockList: blocks })));
}

describe("consistency checker (local provider)", () => {
  it("flags Serfaty vs Sarfaty from the seed Carrefour B2 texts", () => {
    const out = check([{ id: "b1", type: "paragraph", text: "After a final that was 100% advanced maths, Enzo Natali, Nathan Serfaty and Sacha Nardoux were the jury's favourites." }]);
    const mismatch = out.issues.filter((i) => i.type === "NAME_MISMATCH");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0].blockId).toBe("b1");
    expect(mismatch[0].explanation).toContain("Nathan Serfaty");
    expect(mismatch[0].explanation).toContain("Nathan Sarfaty");
    expect(mismatch[0].severity).toBe("warning");
    // The other spelling is flagged too: the editor must pick one before publication.
    const other = check([{ id: "b2", type: "paragraph", text: "Enzo Natali, Nathan Sarfaty and Sacha Nardoux were the jury's favourites." }]);
    expect(other.issues.some((i) => i.type === "NAME_MISMATCH" && i.explanation.includes("both"))).toBe(true);
  });

  it("flags numbers absent from the sources and leaves supported numbers alone", () => {
    const out = check([{ id: "b1", type: "paragraph", text: "Our model predicts an estimated increase in sales of 0.6% per shop across 12 shops." }, { id: "b2", type: "paragraph", text: "Our model predicts an estimated increase in sales of 0.4% per shop." }]);
    const numbers = out.issues.filter((i) => i.type === "NUMBER_MISMATCH");
    expect(numbers.map((n) => n.blockId)).toEqual(["b1", "b1"]);
    expect(numbers.map((n) => n.explanation).join(" ")).toContain("0.6%");
    expect(out.issues.filter((i) => i.blockId === "b2")).toHaveLength(0);
  });

  it("reports sentences with no overlap with any fact as UNSUPPORTED (info)", () => {
    const out = check([{ id: "b1", type: "paragraph", text: "The winning team celebrated with a dinner at the Eiffel Tower restaurant afterwards." }]);
    expect(out.issues).toEqual([expect.objectContaining({ blockId: "b1", type: "UNSUPPORTED", severity: "info" })]);
    expect(out.verdict).toContain("1 issue");
  });

  it("detects an altered quotation and accepts a verbatim one", () => {
    const verbatim = check([{ id: "b1", type: "pullquote", text: "Our model predicts an estimated increase in sales of 0.4% per shop, while perfectly respecting the initial assortment constraints." }]);
    expect(verbatim.issues).toHaveLength(0);
    const altered = check([{ id: "b1", type: "pullquote", text: "Our model predicts a big estimated increase in sales of 0.4% per shop, while respecting most of the initial assortment constraints." }]);
    expect(altered.issues.some((i) => i.type === "QUOTE_ALTERED")).toBe(true);
  });

  it("ignores crossheads and images and says so when everything checks out", () => {
    const out = check([{ id: "h", type: "crosshead", text: "THE INVENTED SECTION" }, { id: "i", type: "image", assetId: "x", caption: "Somebody Unknown" }]);
    expect(out.issues).toHaveLength(0);
    expect(out.verdict).toContain("No inconsistencies");
  });
});
