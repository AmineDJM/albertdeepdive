import { env } from "@/server/env";

type Price = { input: number; output: number }; // EUR per 1M tokens

let table: Map<string, Price> | null = null;

function load() {
  if (table) return table;
  table = new Map();
  for (const entry of env.AI_PRICING.split(";")) {
    const [model, input, output] = entry.split(":");
    if (model && input && output) table.set(model.trim(), { input: Number(input), output: Number(output) });
  }
  return table;
}

/** Estimated cost in euro cents for a call. Unknown models use a conservative default. */
export function estimateCostCents(model: string, inputTokens: number, outputTokens: number) {
  const prices = load();
  const price = prices.get(model) ?? [...prices.entries()].find(([k]) => model.startsWith(k))?.[1] ?? { input: 2, output: 8 };
  const eur = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  return Math.round(eur * 100 * 10000) / 10000;
}

export function resolveModel(tier: "FAST" | "STRONG") {
  return tier === "STRONG" ? env.AI_MODEL_STRONG : env.AI_MODEL_FAST;
}
