import { describe, expect, it } from "vitest";
import { requiredCapabilities, route } from "@/lib/images/router";
import { DEFAULT_ROUTING, MODEL_REGISTRY } from "@/lib/images/capabilities";
import type { ImageEditPlan } from "@/lib/images/types";

const plan = (extra: Partial<ImageEditPlan>): ImageEditPlan => ({ operation: "generate", task: "realistic_scene", change: ["x"], preserve: [], references: [], sensitivity: "LOW", region: null, output: "raster", prompt: "x", source: "local", ...extra });
const all = new Set(MODEL_REGISTRY.map((model) => model.key));

/**
 * Which model gets the job.
 *
 * A protected edit goes to the precise editor; a vector to the illustrator; a poster to the
 * typographer; a photograph to the photorealist with the editor behind it. A model that cannot do
 * what the plan needs is never a candidate, however the console orders it, and nothing connected
 * means nothing — a plain reason per model, not a guess.
 */
describe("routing a picture", () => {
  it("names what a plan cannot do without", () => {
    expect(requiredCapabilities(plan({ output: "vector", task: "illustration" }))).toEqual(["vector"]);
    expect(requiredCapabilities(plan({ task: "typography" }))).toEqual(["typography"]);
    expect(requiredCapabilities(plan({ operation: "localized_edit", task: "precise_edit", sensitivity: "HIGH" }), 3)).toEqual(["precise_edit", "identity_preservation", "multi_reference"]);
    expect(requiredCapabilities(plan({}))).toEqual(["photorealism"]);
    expect(requiredCapabilities(plan({ task: "abstract" }))).toEqual([]);
  });

  it("sends a protected surgical edit to the precise editor, the photorealist behind it", () => {
    const decision = route({ plan: plan({ operation: "localized_edit", task: "precise_edit", sensitivity: "HIGH" }), routing: DEFAULT_ROUTING, available: all, referenceCount: 2 });
    expect(decision.candidates.map((model) => model.key)).toEqual(["sunburst"]);
    expect(decision.reasons["nano-banana-pro"]).toMatch(/lacks precise_edit/);
    expect(decision.reasons.recraft).toBe("cannot edit");
    expect(decision.reasons.briefly).toBe("cannot edit");
  });

  it("sends a global protected edit to the photorealist first when the console says so", () => {
    const decision = route({ plan: plan({ operation: "global_edit", task: "precise_edit", sensitivity: "HIGH" }), routing: { ...DEFAULT_ROUTING, precise_edit: ["nano-banana-pro", "sunburst"] }, available: all, referenceCount: 3 });
    expect(decision.candidates.map((model) => model.key)).toEqual(["nano-banana-pro", "sunburst"]);
  });

  it("sends vectors to the illustrator and posters to the typographer", () => {
    expect(route({ plan: plan({ task: "illustration", output: "vector" }), routing: DEFAULT_ROUTING, available: all }).candidates.map((model) => model.key)).toEqual(["recraft"]);
    const poster = route({ plan: plan({ task: "typography" }), routing: DEFAULT_ROUTING, available: all });
    expect(poster.candidates.map((model) => model.key)).toEqual(["ideogram"]);
    expect(poster.reasons.sunburst).toMatch(/lacks typography/);
  });

  it("falls back to Briefly's own field for an abstract ground, never for an edit", () => {
    const abstract = route({ plan: plan({ task: "abstract" }), routing: DEFAULT_ROUTING, available: new Set(["briefly"]) });
    expect(abstract.candidates.map((model) => model.key)).toEqual(["briefly"]);
    const scene = route({ plan: plan({ task: "realistic_scene" }), routing: DEFAULT_ROUTING, available: all });
    expect(scene.candidates.map((model) => model.key)).toEqual(["nano-banana-pro", "sunburst", "higgsfield", "briefly"]);
    expect(scene.reasons.recraft).toMatch(/lacks photorealism/);
  });

  it("drops a model the mask or the references rule out", () => {
    const masked = route({ plan: plan({ operation: "localized_edit", task: "precise_edit" }), routing: { ...DEFAULT_ROUTING, precise_edit: ["nano-banana-pro", "sunburst"] }, available: all, needsMask: true });
    expect(masked.candidates.map((model) => model.key)).toEqual(["sunburst"]);
    expect(masked.reasons["nano-banana-pro"]).toBe("no mask");
    const many = route({ plan: plan({ operation: "global_edit", task: "precise_edit" }), routing: DEFAULT_ROUTING, available: all, referenceCount: 5 });
    expect(many.candidates.map((model) => model.key)).toEqual(["nano-banana-pro"]);
    expect(many.reasons.sunburst).toBe("too many references");
  });

  it("says plainly when nothing connected can do the job", () => {
    const decision = route({ plan: plan({ operation: "localized_edit", task: "precise_edit" }), routing: DEFAULT_ROUTING, available: new Set() });
    expect(decision.candidates).toEqual([]);
    expect(decision.reasons.sunburst).toBe("not connected");
  });

  it("breaks ties among unnamed models by how they have done here", () => {
    const routing = { ...DEFAULT_ROUTING, realistic_scene: [] as string[] };
    const stats = { sunburst: { attempts: 10, succeeded: 9, averageQa: 0.85 }, "nano-banana-pro": { attempts: 10, succeeded: 4, averageQa: 0.5 } };
    const decision = route({ plan: plan({}), routing, available: new Set(["sunburst", "nano-banana-pro"]), stats });
    expect(decision.candidates.map((model) => model.key)).toEqual(["sunburst", "nano-banana-pro"]);
  });
});
