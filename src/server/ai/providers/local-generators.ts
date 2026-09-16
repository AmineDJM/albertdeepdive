import type { ProviderRequest } from "../types";

/** Placeholder — replaced by the AI module with per-service deterministic generators. */
export function generateLocal(request: ProviderRequest): unknown {
  throw new Error(`Local generator not implemented for ${request.hints.service}`);
}
