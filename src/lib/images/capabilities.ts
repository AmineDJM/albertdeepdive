import type { Capability, ImageTask } from "./types";

/**
 * The models Briefly can ask for a picture, by what each is good at.
 *
 * Nothing in the product asks for a model by name. It asks for capabilities — precise editing,
 * identity preservation, vector output — and this registry says which model has them. A new model
 * is a new entry; a better one for a job is a change to the routing configuration; neither is a
 * change to any code that makes pictures.
 *
 * Provider model identifiers are defaults a platform admin overrides in the console, because they
 * change faster than releases.
 */

export type ImageProviderName = "google" | "openai" | "recraft" | "ideogram" | "higgsfield" | "briefly";

export type ImageModelDefinition = {
  key: string;
  provider: ImageProviderName;
  /** The provider's identifier for the model; the console can replace it. */
  model: string;
  label: string;
  capabilities: Capability[];
  operations: ("generate" | "edit")[];
  supportsMask: boolean;
  maxReferences: number;
  outputs: ("raster" | "vector")[];
  /** What one picture costs us, in cents, for the ledger and the plan. */
  centsPerImage: number;
};

export const MODEL_REGISTRY: ImageModelDefinition[] = [
  {
    key: "nano-banana-pro",
    provider: "google",
    model: "gemini-3-pro-image-preview",
    label: "Nano Banana Pro",
    capabilities: ["photorealism", "multi_reference", "identity_preservation", "background_edit", "style_reference"],
    operations: ["generate", "edit"],
    supportsMask: false,
    maxReferences: 6,
    outputs: ["raster"],
    centsPerImage: 13,
  },
  {
    key: "sunburst",
    provider: "openai",
    model: "gpt-image-1",
    label: "GPT Image (Sunburst)",
    capabilities: ["precise_edit", "inpainting", "background_edit", "identity_preservation", "multi_reference", "photorealism"],
    operations: ["generate", "edit"],
    supportsMask: true,
    maxReferences: 4,
    outputs: ["raster"],
    centsPerImage: 4,
  },
  {
    key: "recraft",
    provider: "recraft",
    model: "recraftv3",
    label: "Recraft",
    capabilities: ["vector", "illustration", "style_reference"],
    operations: ["generate"],
    supportsMask: false,
    maxReferences: 1,
    outputs: ["raster", "vector"],
    centsPerImage: 4,
  },
  {
    key: "ideogram",
    provider: "ideogram",
    model: "ideogram-v3",
    label: "Ideogram",
    capabilities: ["typography", "illustration", "inpainting"],
    operations: ["generate", "edit"],
    supportsMask: true,
    maxReferences: 1,
    outputs: ["raster"],
    centsPerImage: 6,
  },
  {
    key: "higgsfield",
    provider: "higgsfield",
    model: "higgsfield-ai/soul/v2/standard",
    label: "Higgsfield Soul",
    capabilities: ["photorealism"],
    operations: ["generate"],
    supportsMask: false,
    maxReferences: 0,
    outputs: ["raster"],
    centsPerImage: 4,
  },
  {
    key: "briefly",
    provider: "briefly",
    model: "briefly-field",
    label: "Briefly's own",
    capabilities: [],
    operations: ["generate"],
    supportsMask: false,
    maxReferences: 0,
    outputs: ["raster"],
    centsPerImage: 0,
  },
];

export function modelByKey(key: string, registry: ImageModelDefinition[] = MODEL_REGISTRY): ImageModelDefinition | null {
  return registry.find((entry) => entry.key === key) ?? null;
}

/** Which models to try, in order, for each kind of job. The console can rewrite this. */
export type RoutingConfig = Record<ImageTask, string[]>;

export const DEFAULT_ROUTING: RoutingConfig = {
  realistic_scene: ["nano-banana-pro", "sunburst", "higgsfield", "briefly"],
  precise_edit: ["sunburst", "nano-banana-pro"],
  illustration: ["recraft", "nano-banana-pro", "sunburst"],
  typography: ["ideogram", "recraft", "sunburst"],
  abstract: ["briefly", "recraft", "sunburst"],
};

/** A configuration from the console, kept sane: unknown keys and unknown models are dropped, gaps filled from the default. */
export function parseRouting(raw: string | null | undefined, registry: ImageModelDefinition[] = MODEL_REGISTRY): RoutingConfig {
  const known = new Set(registry.map((entry) => entry.key));
  const routing: RoutingConfig = { ...DEFAULT_ROUTING };
  if (!raw?.trim()) return routing;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const task of Object.keys(DEFAULT_ROUTING) as ImageTask[]) {
      const list = parsed[task];
      if (Array.isArray(list)) {
        const cleaned = list.filter((key): key is string => typeof key === "string" && known.has(key));
        if (cleaned.length) routing[task] = cleaned;
      }
    }
  } catch {
    // A broken configuration is the default configuration, and the console's test says so.
  }
  return routing;
}
