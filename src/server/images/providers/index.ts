import { integrationConfig } from "@/server/integrations/service";
import { MODEL_REGISTRY, parseRouting, type ImageModelDefinition, type ImageProviderName, type RoutingConfig } from "@/lib/images/capabilities";
import { BrieflyImageProvider } from "./briefly";
import { GoogleImageProvider } from "./google";
import { HiggsfieldImageProvider } from "./higgsfield";
import { IdeogramProvider } from "./ideogram";
import { OpenAiImageProvider } from "./openai";
import { RecraftProvider } from "./recraft";
import type { ImageProvider } from "./types";

/**
 * Which providers are connected, and what the console says about routing.
 *
 * Read on every job rather than once at boot: connecting Google in the console must take effect
 * on the next picture. The registry's model identifiers can be overridden per provider here,
 * because those change faster than releases.
 */

export type ImageEngineConfig = {
  routing: RoutingConfig;
  registry: ImageModelDefinition[];
  qaPassAt: number;
  qaRetryBelow: number;
  maxRetries: number;
  defaultVariations: number | null;
  /** Whether the customer's screens may show which model made a picture. Platform staff always see it. */
  showRouting: boolean;
  visionQa: boolean;
};

function num(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value?.trim() ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export async function imageEngineConfig(): Promise<ImageEngineConfig> {
  const [images, openai, google, recraft, ideogram, higgsfield] = await Promise.all(["images", "openai", "google", "recraft", "ideogram", "higgsfield"].map((key) => integrationConfig(key)));
  const overrides: Partial<Record<ImageProviderName, string | null>> = { openai: images.openaiModel, google: google.imageModel, recraft: recraft.model, ideogram: ideogram.model, higgsfield: higgsfield.imageModel };
  const registry = MODEL_REGISTRY.map((entry) => (overrides[entry.provider]?.trim() ? { ...entry, model: overrides[entry.provider]!.trim() } : entry));
  void openai;
  const variations = Number(images.defaultVariations);
  return {
    routing: parseRouting(images.routing, registry),
    registry,
    qaPassAt: num(images.qaPassAt, 0.7, 0.3, 0.95),
    qaRetryBelow: num(images.qaRetryBelow, 0.45, 0.1, 0.9),
    maxRetries: num(images.maxRetries, 2, 0, 5),
    defaultVariations: Number.isInteger(variations) && variations >= 1 ? Math.min(4, variations) : null,
    showRouting: /^(true|1|yes|on)$/i.test(images.showRouting ?? ""),
    visionQa: !/^(false|0|no|off)$/i.test(images.visionQa ?? ""),
  };
}

let overrideProviders: Partial<Record<ImageProviderName, ImageProvider>> | null = null;

/** Stand-ins for tests: named providers replace the real ones; the rest are absent. */
export function setImageProvidersForTests(providers: Partial<Record<ImageProviderName, ImageProvider>> | null) {
  overrideProviders = providers;
}

export async function imageProvider(name: ImageProviderName): Promise<ImageProvider | null> {
  if (overrideProviders) return overrideProviders[name] ?? null;
  switch (name) {
    case "openai": {
      const config = await integrationConfig("openai");
      const { env } = await import("@/server/env");
      const apiKey = config.apiKey ?? env.OPENAI_API_KEY ?? null;
      // No key at all and no proxy is a provider that cannot answer; the proxy case is a key that says so.
      if (!apiKey && !process.env.HTTPS_PROXY) return null;
      return new OpenAiImageProvider({ apiKey, baseUrl: config.baseUrl || env.OPENAI_BASE_URL });
    }
    case "google": {
      const config = await integrationConfig("google");
      return config.apiKey ? new GoogleImageProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl }) : null;
    }
    case "recraft": {
      const config = await integrationConfig("recraft");
      return config.apiKey ? new RecraftProvider({ apiKey: config.apiKey }) : null;
    }
    case "ideogram": {
      const config = await integrationConfig("ideogram");
      return config.apiKey ? new IdeogramProvider({ apiKey: config.apiKey }) : null;
    }
    case "higgsfield": {
      const provider = new HiggsfieldImageProvider();
      return (await provider.available()) ? provider : null;
    }
    case "briefly":
      return new BrieflyImageProvider();
    default:
      return null;
  }
}

/** The model keys whose provider is connected right now. */
export async function availableModels(registry: ImageModelDefinition[] = MODEL_REGISTRY): Promise<Set<string>> {
  const available = new Set<string>();
  const providers = [...new Set(registry.map((entry) => entry.provider))];
  const connected = await Promise.all(providers.map(async (name) => [name, (await imageProvider(name)) !== null] as const));
  const ok = new Set(connected.filter(([, yes]) => yes).map(([name]) => name));
  for (const entry of registry) if (ok.has(entry.provider)) available.add(entry.key);
  return available;
}

export type { ImageProvider, ImageRequest, ImageResult } from "./types";
