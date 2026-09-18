import { z } from "zod";

/**
 * The seen check: a model that can look at the picture says whether it is the one asked for.
 *
 * Runs directly against the OpenAI client rather than through the text pipeline, because it sends
 * pictures. Answers null rather than throwing when it cannot run — the numbers still stand.
 */

export const imageQaSchema = z.object({
  adherence: z.number(),
  fidelity: z.number(),
  quality: z.number(),
  issues: z.array(z.string()),
  unwantedChanges: z.array(z.string()),
});
export type ImageQaOutput = z.infer<typeof imageQaSchema>;

export type VisionQaInput = { plan: { change: string[]; preserve: string[]; sensitivity: string; operation: string }; before: { bytes: Buffer; mimeType: string } | null; after: { bytes: Buffer; mimeType: string } };

export async function visionQa(input: VisionQaInput): Promise<{ output: ImageQaOutput; model: string; inputTokens: number; outputTokens: number } | null> {
  const { getAiProvider } = await import("@/server/ai/run");
  if (getAiProvider().name !== "openai") return null;
  const { integrationConfig } = await import("@/server/integrations/service");
  const { env } = await import("@/server/env");
  const config = await integrationConfig("openai");
  const apiKey = config.apiKey ?? env.OPENAI_API_KEY;
  const proxyManaged = !apiKey || apiKey === "proxy" || apiKey === "proxy-injected";
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: proxyManaged ? "proxy-injected" : apiKey, baseURL: config.baseUrl || env.OPENAI_BASE_URL || undefined, defaultHeaders: proxyManaged ? { Authorization: null } : undefined, maxRetries: 1, timeout: 90_000 });
  const { toStrictJsonSchema } = await import("@/server/ai/json-schema");
  const dataUrl = (image: { bytes: Buffer; mimeType: string }) => `data:${image.mimeType};base64,${image.bytes.toString("base64")}`;
  const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } })[] = [];
  if (input.before) {
    content.push({ type: "text", text: "BEFORE — the picture as it was:" });
    content.push({ type: "image_url", image_url: { url: dataUrl(input.before), detail: "high" } });
  }
  content.push({ type: "text", text: input.before ? "AFTER — the edited picture:" : "The picture that was made:" });
  content.push({ type: "image_url", image_url: { url: dataUrl(input.after), detail: "high" } });
  content.push({
    type: "text",
    text: `Asked for: ${input.plan.change.join("; ") || "—"}.\nMust stay unchanged: ${input.plan.preserve.join("; ") || "—"}.\nSensitivity: ${input.plan.sensitivity}. Operation: ${input.plan.operation}.\n\nScore from 0 to 1: adherence (did the asked-for change happen), fidelity (do protected things — faces, products, logos, buildings, everything not named — look the same as before; 1 for a fresh picture with nothing to compare), quality (no extra limbs, warped hands, broken geometry, text artifacts, duplicated objects, wrong reflections or shadows). List issues you can see, and anything that changed without being asked.`,
  });
  const completion = await client.chat.completions.create({
    model: config.modelStrong || env.AI_MODEL_STRONG,
    temperature: 0,
    max_completion_tokens: 500,
    messages: [
      { role: "system", content: "You check pictures for a publisher. Be exact and unsentimental: a face that drifted is a failure, a hand with six fingers is a failure, a change nobody asked for is a failure." },
      { role: "user", content },
    ],
    response_format: { type: "json_schema", json_schema: { name: "image_qa", schema: toStrictJsonSchema(imageQaSchema), strict: true } },
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;
  const parsed = imageQaSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return null;
  return { output: parsed.data, model: completion.model, inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 };
}
