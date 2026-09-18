import { describe, expect, it } from "vitest";
import { accumulateSpec, classifySensitivity, heuristicPlan, inferOperation, inferTask, promptFor, reconcilePlans, REGENERATE_AFTER, shouldRegenerate, strengthen, type PlanContext } from "@/lib/images/plan";
import { DEFAULT_ROUTING, MODEL_REGISTRY, parseRouting } from "@/lib/images/capabilities";

const nobody: PlanContext["subject"] = { people: false, product: false, logo: false, architecture: false, text: false };
const edit = (subject: Partial<PlanContext["subject"]> = {}, extra: Partial<PlanContext> = {}): PlanContext => ({ isEdit: true, subject: { ...nobody, ...subject }, offered: ["current_version", "original_master"], ...extra });
const make = (extra: Partial<PlanContext> = {}): PlanContext => ({ isEdit: false, subject: nobody, offered: [], ...extra });

/**
 * From a sentence to a plan.
 *
 * The rules must read "keep everything identical but replace the phone with our product" as a
 * small, protected edit, and "make it warmer" as a free one — and hold a model to that reading.
 */
describe("planning a picture", () => {
  it("names the kind of job from the words", () => {
    expect(inferTask("A photograph of the campus at dusk", make())).toBe("realistic_scene");
    expect(inferTask("A flat vector icon set for the app", make())).toBe("illustration");
    expect(inferTask("A poster with a bold headline for the launch", make())).toBe("typography");
    expect(inferTask("An abstract gradient texture", make())).toBe("abstract");
    expect(inferTask("Make it warmer", edit())).toBe("precise_edit");
  });

  it("tells a surgical edit from a global one", () => {
    expect(inferOperation("Remove the bin on the left", edit())).toBe("localized_edit");
    expect(inferOperation("Keep everything identical but replace the phone with our product", edit())).toBe("localized_edit");
    expect(inferOperation("Make the whole picture warmer", edit())).toBe("global_edit");
    expect(inferOperation("Change the background to a beach", edit())).toBe("global_edit");
    expect(inferOperation("Anything", make())).toBe("generate");
  });

  it("protects faces, products, logos, buildings and any 'only'", () => {
    expect(classifySensitivity("Make the sky bluer", edit())).toBe("LOW");
    expect(classifySensitivity("Make the sky bluer", edit({ people: true }))).toBe("HIGH");
    expect(classifySensitivity("Replace the phone with our product", edit())).toBe("HIGH");
    expect(classifySensitivity("Keep everything identical but brighten the plant", edit())).toBe("HIGH");
    expect(classifySensitivity("Swap the chair for a stool", edit())).toBe("MEDIUM");
    expect(classifySensitivity("A portrait of a founder", make())).toBe("MEDIUM");
    // "Preserve more" raises a free edit; nothing lowers a protected one.
    expect(classifySensitivity("Make the sky bluer", edit({}, { latitude: -1 }))).toBe("MEDIUM");
    expect(classifySensitivity("Make the sky bluer", edit({ people: true }, { latitude: 1 }))).toBe("HIGH");
  });

  it("writes a plan that keeps what was not asked for", () => {
    const plan = heuristicPlan("Keep everything identical but replace the phone with our product", edit({ product: true }, { offered: ["current_version", "original_master", "product_reference"] }));
    expect(plan.operation).toBe("localized_edit");
    expect(plan.sensitivity).toBe("HIGH");
    expect(plan.references).toEqual(expect.arrayContaining(["current_version", "original_master", "product_reference"]));
    expect(plan.preserve).toEqual(expect.arrayContaining(["product geometry", "everything not named in the change"]));
    expect(plan.prompt).toMatch(/Keep exactly as in the reference/);
    expect(plan.prompt).toMatch(/No written words/);
    expect(plan.source).toBe("local");
  });

  it("asks for a vector when the words do", () => {
    expect(heuristicPlan("A set of vector icons for the four services", make()).output).toBe("vector");
    expect(heuristicPlan("An illustrated map of the campus", make()).output).toBe("raster");
  });

  it("lets a model add but never lower the floor", () => {
    const context = edit({ people: true });
    const floor = heuristicPlan("Make the sky bluer", context);
    const plan = reconcilePlans({ sensitivity: "LOW", references: ["style_reference"], change: ["a deeper blue sky, late afternoon"], region: { x: 0, y: 0, width: 1, height: 0.4 }, prompt: "Deepen the sky." }, floor, context);
    expect(plan.sensitivity).toBe("HIGH");
    expect(plan.change).toEqual(["a deeper blue sky, late afternoon"]);
    expect(plan.references).not.toContain("style_reference"); // not on offer
    expect(plan.references).toContain("current_version");
    expect(plan.region).toEqual({ x: 0, y: 0, width: 1, height: 0.4 });
    expect(plan.prompt).toMatch(/^Deepen the sky\./);
    expect(plan.prompt).toMatch(/facial identity/);
    expect(plan.source).toBe("model");
    // A malformed region is no region.
    expect(reconcilePlans({ region: { x: 2, y: 0, width: 1, height: 1 } }, floor, context).region).toBeNull();
  });

  it("strengthens only the protected edits, once", () => {
    const once = strengthen("Do it.", { sensitivity: "HIGH", preserve: ["the face"], operation: "localized_edit" });
    expect(once).toMatch(/Every pixel outside/);
    expect(strengthen(once, { sensitivity: "HIGH", preserve: ["the face"], operation: "localized_edit" })).toBe(once);
    expect(strengthen("Do it.", { sensitivity: "LOW", preserve: ["the face"], operation: "global_edit" })).toBe("Do it.");
  });

  it("never lets the picture engine draw words or logos", () => {
    const poster = promptFor({ ...heuristicPlan("A poster with a bold headline", make()) }, { instruction: "A poster with a bold headline" });
    expect(poster).toMatch(/placeholder shapes only/);
    expect(poster).toMatch(/no logo unless one is supplied/);
    const branded = promptFor(heuristicPlan("An illustration of the office", make()), { instruction: "x", brand: { palette: ["#1F3A5F", "#C2603C"], avoid: ["stock-photo smiles"] } });
    expect(branded).toMatch(/Colours drawn from: #1F3A5F, #C2603C/);
    expect(branded).toMatch(/Avoid: stock-photo smiles/);
  });

  it("folds a line of edits into one specification and knows when to start over", () => {
    const a = heuristicPlan("Brighten the plant only", edit({ people: true }));
    const b = heuristicPlan("Make her jacket navy", edit({ people: true }));
    const spec = accumulateSpec([a, null, b]);
    expect(spec.change).toEqual([...a.change, ...b.change]);
    expect(spec.sensitivity).toBe("HIGH");
    expect(spec.preserve).toContain("facial identity");
    expect(shouldRegenerate("HIGH", REGENERATE_AFTER)).toBe(true);
    expect(shouldRegenerate("HIGH", REGENERATE_AFTER - 1)).toBe(false);
    expect(shouldRegenerate("LOW", 10)).toBe(false);
  });

  it("keeps the routing configuration sane", () => {
    expect(parseRouting(null)).toEqual(DEFAULT_ROUTING);
    expect(parseRouting("not json")).toEqual(DEFAULT_ROUTING);
    const custom = parseRouting(JSON.stringify({ precise_edit: ["nano-banana-pro", "made-up", "sunburst"], nonsense: ["sunburst"], illustration: [] }));
    expect(custom.precise_edit).toEqual(["nano-banana-pro", "sunburst"]);
    expect(custom.illustration).toEqual(DEFAULT_ROUTING.illustration);
    expect(Object.keys(custom).sort()).toEqual(Object.keys(DEFAULT_ROUTING).sort());
    for (const keys of Object.values(DEFAULT_ROUTING)) for (const key of keys) expect(MODEL_REGISTRY.some((model) => model.key === key)).toBe(true);
  });
});
