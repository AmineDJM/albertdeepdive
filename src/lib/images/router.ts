import { MODEL_REGISTRY, type ImageModelDefinition, type RoutingConfig } from "./capabilities";
import type { Capability, ImageEditPlan } from "./types";

/**
 * Which model gets the job, and who is next if it fails.
 *
 * The plan says what the job needs — an edit, a mask, a vector, a face kept — and the routing
 * configuration says the order of preference for its kind. A model that cannot do what the plan
 * needs is not a candidate however high the configuration puts it; among the ones that can, the
 * configuration's order holds, tie-broken by how each has actually done at this kind of job here.
 */

export type ModelStats = Record<string, { attempts: number; succeeded: number; averageQa: number | null }>;

export type RouteInput = {
  plan: ImageEditPlan;
  routing: RoutingConfig;
  /** Models whose provider is connected right now. */
  available: Set<string>;
  registry?: ImageModelDefinition[];
  stats?: ModelStats;
  /** How many references the job carries. */
  referenceCount?: number;
  needsMask?: boolean;
};

export type RouteDecision = { candidates: ImageModelDefinition[]; required: Capability[]; reasons: Record<string, string> };

/** The capabilities a plan cannot do without. */
export function requiredCapabilities(plan: ImageEditPlan, referenceCount = 0): Capability[] {
  const needed = new Set<Capability>();
  if (plan.output === "vector") needed.add("vector");
  if (plan.task === "realistic_scene") needed.add("photorealism");
  if (plan.task === "typography") needed.add("typography");
  if (plan.task === "illustration" && plan.output !== "vector") needed.add("illustration");
  if (plan.operation === "localized_edit") needed.add("precise_edit");
  if (plan.operation !== "generate" && plan.sensitivity === "HIGH") needed.add("identity_preservation");
  if (referenceCount > 1) needed.add("multi_reference");
  return [...needed];
}

export function route(input: RouteInput): RouteDecision {
  const registry = input.registry ?? MODEL_REGISTRY;
  const required = requiredCapabilities(input.plan, input.referenceCount ?? 0);
  const isEdit = input.plan.operation !== "generate";
  const reasons: Record<string, string> = {};
  const ordered = input.routing[input.plan.task] ?? [];

  const fits = (model: ImageModelDefinition): string | null => {
    if (!input.available.has(model.key)) return "not connected";
    if (isEdit && !model.operations.includes("edit")) return "cannot edit";
    if (input.needsMask && !model.supportsMask) return "no mask";
    if ((input.referenceCount ?? 0) > model.maxReferences && isEdit) return "too many references";
    const missing = required.filter((capability) => !model.capabilities.includes(capability));
    // Briefly's own field is the last resort for a generation only; it never edits and never claims a capability.
    if (missing.length && model.key !== "briefly") return `lacks ${missing.join(", ")}`;
    if (model.key === "briefly" && (isEdit || required.some((capability) => capability !== "photorealism"))) return "only draws abstract grounds";
    return null;
  };

  const candidates: ImageModelDefinition[] = [];
  const considered = new Set<string>();
  for (const key of [...ordered, ...registry.map((model) => model.key)]) {
    if (considered.has(key)) continue;
    considered.add(key);
    const model = registry.find((entry) => entry.key === key);
    if (!model) continue;
    const reason = fits(model);
    if (reason) reasons[key] = reason;
    else candidates.push(model);
  }

  // The configured order first; models the configuration did not name come after, by how they have done.
  const position = new Map(ordered.map((key, index) => [key, index]));
  const score = (model: ImageModelDefinition) => {
    const stat = input.stats?.[model.key];
    if (!stat || !stat.attempts) return 0.5;
    return stat.succeeded / stat.attempts + (stat.averageQa ?? 0) * 0.25;
  };
  candidates.sort((a, b) => {
    const pa = position.get(a.key) ?? 999;
    const pb = position.get(b.key) ?? 999;
    if (pa !== pb) return pa - pb;
    return score(b) - score(a);
  });
  return { candidates, required, reasons };
}
