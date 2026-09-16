import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiJobs, promptTemplates } from "@/server/db/schema";
import { env } from "@/server/env";
import { createLogger } from "@/server/logger";
import { toStrictJsonSchema } from "./json-schema";
import { estimateCostCents, resolveModel } from "./pricing";
import { getPromptDefault } from "./prompts";
import type { AiProvider, AiTaskRequest, AiTaskResult, ModelTier } from "./types";
import { AiOutputError } from "./types";

const log = createLogger("ai");

let provider: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (provider) return provider;
  if (env.AI_PROVIDER === "openai") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { OpenAiProvider } = require("./providers/openai") as typeof import("./providers/openai");
    provider = new OpenAiProvider();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalProvider } = require("./providers/local") as typeof import("./providers/local");
    provider = new LocalProvider();
  }
  return provider;
}

/** Test hook. */
export function setAiProvider(p: AiProvider | undefined) {
  provider = p;
}

type ResolvedPrompt = {
  id: string | null;
  key: string;
  version: number;
  system: string;
  user: string;
  tier: ModelTier;
  temperature: number;
  maxOutputTokens: number;
};

const promptCache = new Map<string, { at: number; value: ResolvedPrompt }>();

export function invalidatePromptCache() {
  promptCache.clear();
}

export async function resolvePrompt(key: string): Promise<ResolvedPrompt> {
  const cached = promptCache.get(key);
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  let value: ResolvedPrompt | null = null;
  try {
    const row = await db.query.promptTemplates.findFirst({
      where: and(eq(promptTemplates.key, key), eq(promptTemplates.isActive, true)),
      orderBy: [desc(promptTemplates.version)],
    });
    if (row) {
      value = { id: row.id, key, version: row.version, system: row.systemPrompt, user: row.userPrompt, tier: row.modelTier, temperature: row.temperature, maxOutputTokens: row.maxOutputTokens };
    }
  } catch (err) {
    log.warn("prompt lookup failed, using defaults", { key, err });
  }
  if (!value) {
    const def = getPromptDefault(key);
    if (!def) throw new Error(`No prompt template for key "${key}"`);
    value = { id: null, key, version: 0, system: def.system, user: def.user, tier: def.tier, temperature: def.temperature, maxOutputTokens: def.maxOutputTokens };
  }
  promptCache.set(key, { at: Date.now(), value });
  return value;
}

export function renderTemplate(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null || v === "") return "—";
    if (typeof v === "string") return v;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return (v as string[]).join(", ");
    return JSON.stringify(v, null, 1);
  });
}

function hashInput(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40);
}

/**
 * Runs one AI task with structured output, validation, caching and full logging in `ai_jobs`.
 * Every transformation in the newsroom goes through this function.
 */
export async function runAiTask<T>(req: AiTaskRequest<T>): Promise<AiTaskResult<T>> {
  const prov = getAiProvider();
  const prompt = await resolvePrompt(req.promptKey ?? req.service);
  const tier = req.tier ?? prompt.tier;
  const model = prov.name === "local" ? "local-deterministic" : resolveModel(tier);
  const temperature = req.temperature ?? prompt.temperature;
  const maxOutputTokens = req.maxOutputTokens ?? prompt.maxOutputTokens;
  const system = renderTemplate(prompt.system, req.input);
  const user = renderTemplate(prompt.user, req.input);
  const schema = toStrictJsonSchema(req.schema);
  const inputHash = hashInput([req.service, prompt.version, model, system, user]);

  if (req.cacheable !== false) {
    const cachedRow = await db.query.aiJobs.findFirst({
      where: and(eq(aiJobs.service, req.service), eq(aiJobs.inputHash, inputHash), eq(aiJobs.status, "SUCCEEDED")),
      orderBy: [desc(aiJobs.createdAt)],
    });
    if (cachedRow) {
      const parsed = req.schema.safeParse(cachedRow.output);
      if (parsed.success) {
        const [row] = await db
          .insert(aiJobs)
          .values({
            service: req.service,
            provider: prov.name,
            model,
            promptTemplateId: prompt.id,
            promptKey: prompt.key,
            promptVersion: prompt.version,
            editionId: req.editionId ?? null,
            entityType: req.entityType ?? null,
            entityId: req.entityId ?? null,
            status: "SUCCEEDED",
            inputRefs: summariseInput(req.input),
            inputHash,
            output: cachedRow.output,
            confidence: cachedRow.confidence,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            costCents: "0",
            attempts: 0,
            cached: true,
            jobId: req.jobId ?? null,
            completedAt: new Date(),
          })
          .returning({ id: aiJobs.id });
        return { output: parsed.data, aiJobId: row.id, model, provider: prov.name, cached: true, usage: { inputTokens: 0, outputTokens: 0, costCents: 0, latencyMs: 0 }, confidence: cachedRow.confidence };
      }
    }
  }

  const [pending] = await db
    .insert(aiJobs)
    .values({
      service: req.service,
      provider: prov.name,
      model,
      promptTemplateId: prompt.id,
      promptKey: prompt.key,
      promptVersion: prompt.version,
      editionId: req.editionId ?? null,
      entityType: req.entityType ?? null,
      entityId: req.entityId ?? null,
      status: "RUNNING",
      inputRefs: summariseInput(req.input),
      inputHash,
      attempts: 0,
      jobId: req.jobId ?? null,
    })
    .returning({ id: aiJobs.id });

  const started = Date.now();
  let attempts = 0;
  let lastError: unknown = null;
  let totalIn = 0;
  let totalOut = 0;

  while (attempts < 2) {
    attempts += 1;
    try {
      const repair = attempts > 1 && lastError instanceof AiOutputError ? `\n\nYour previous answer was invalid: ${lastError.message}. Return valid JSON matching the schema exactly.` : "";
      const res = await prov.complete({ system, user: user + repair, model, temperature, maxOutputTokens, schema, schemaName: req.schemaName, hints: { service: req.service, input: req.input } });
      totalIn += res.inputTokens;
      totalOut += res.outputTokens;
      const parsed = req.schema.safeParse(res.raw);
      if (!parsed.success) {
        throw new AiOutputError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), res.raw);
      }
      const latencyMs = Date.now() - started;
      const costCents = estimateCostCents(res.model, totalIn, totalOut);
      const confidence = extractConfidence(parsed.data);
      await db
        .update(aiJobs)
        .set({ status: "SUCCEEDED", output: parsed.data as unknown, confidence, latencyMs, inputTokens: totalIn, outputTokens: totalOut, costCents: String(costCents), attempts, model: res.model, completedAt: new Date() })
        .where(eq(aiJobs.id, pending.id));
      log.info("task ok", { service: req.service, model: res.model, latencyMs, inputTokens: totalIn, outputTokens: totalOut, costCents });
      return { output: parsed.data, aiJobId: pending.id, model: res.model, provider: prov.name, cached: false, usage: { inputTokens: totalIn, outputTokens: totalOut, costCents, latencyMs }, confidence };
    } catch (err) {
      lastError = err;
      log.warn("task attempt failed", { service: req.service, attempt: attempts, err });
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await db
    .update(aiJobs)
    .set({ status: "FAILED", error: message.slice(0, 4000), latencyMs: Date.now() - started, inputTokens: totalIn, outputTokens: totalOut, attempts, completedAt: new Date() })
    .where(eq(aiJobs.id, pending.id));
  throw lastError instanceof Error ? lastError : new Error(message);
}

function summariseInput(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") out[k] = v.length > 200 ? `${v.slice(0, 200)}… (${v.length} chars)` : v;
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else if (v && typeof v === "object") out[k] = "{…}";
    else out[k] = v;
  }
  return out;
}

function extractConfidence(output: unknown): number | null {
  if (output && typeof output === "object" && "confidence" in output) {
    const c = (output as { confidence: unknown }).confidence;
    if (typeof c === "number") return Math.max(0, Math.min(1, c));
  }
  return null;
}
