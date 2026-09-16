import OpenAI from "openai";
import { env } from "@/server/env";
import type { AiProvider, ProviderRequest, ProviderResponse } from "../types";
import { AiOutputError } from "../types";

export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY || "proxy-managed",
      baseURL: env.OPENAI_BASE_URL || undefined,
      maxRetries: 2,
      timeout: 120_000,
    });
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const completion = await this.client.chat.completions.create({
      model: request.model,
      temperature: request.temperature,
      max_completion_tokens: request.maxOutputTokens,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: request.schemaName, schema: request.schema, strict: true },
      },
    });
    const choice = completion.choices[0];
    const content = choice?.message?.content;
    if (!content) throw new AiOutputError(`Empty response (finish_reason=${choice?.finish_reason ?? "unknown"})`, null);
    if (choice.message.refusal) throw new AiOutputError(`Model refused: ${choice.message.refusal}`, null);
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new AiOutputError("Response was not valid JSON", content);
    }
    return {
      raw,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      model: completion.model ?? request.model,
    };
  }
}
