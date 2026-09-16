import type { AiProvider, ProviderRequest, ProviderResponse } from "../types";

/** Deterministic development provider — real generators live in ./local-generators (see AI module). */
export class LocalProvider implements AiProvider {
  readonly name = "local" as const;
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const { generateLocal } = await import("./local-generators");
    const raw = generateLocal(request);
    const inputTokens = Math.ceil((request.system.length + request.user.length) / 4);
    const outputTokens = Math.ceil(JSON.stringify(raw).length / 4);
    return { raw, inputTokens, outputTokens, model: "local-deterministic" };
  }
}
