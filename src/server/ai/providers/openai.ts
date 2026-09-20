import OpenAI from "openai";
import { env } from "@/server/env";
import type { AiProvider, ProviderRequest, ProviderResponse } from "../types";
import { AiOutputError } from "../types";

export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;

  /**
   * Built per call rather than in the constructor, because the key can be changed in the
   * integrations console and must take effect without a restart. The client is cheap to construct;
   * the network call that follows it is not.
   */
  private async clientFor(): Promise<OpenAI> {
    const { integrationConfig } = await import("@/server/integrations/service");
    const config = await integrationConfig("openai");
    const apiKey = config.apiKey ?? env.OPENAI_API_KEY;
    // With no real key an egress proxy may inject credentials, so send no Authorization header.
    const proxyManaged = !apiKey || apiKey === "proxy" || apiKey === "proxy-injected";
    return new OpenAI({
      apiKey: proxyManaged ? "proxy-injected" : apiKey,
      baseURL: config.baseUrl || env.OPENAI_BASE_URL || undefined,
      defaultHeaders: proxyManaged ? { Authorization: null } : undefined,
      maxRetries: 2,
      timeout: 120_000,
    });
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const client = await this.clientFor();
    const completion = await client.chat.completions.create({
      model: request.model,
      temperature: request.temperature,
      max_completion_tokens: request.maxOutputTokens,
      messages: [
        { role: "system", content: request.system },
        /*
         * Words and pictures in the same turn.
         *
         * A task with no pictures sends the string it always sent — the wire format is identical,
         * so nothing that worked before changes shape. A task with pictures sends the text first
         * and the images after it, each labelled, because "the second page" means nothing to a
         * model handed three unnamed pictures.
         */
        {
          role: "user",
          content: request.images?.length
            ? [
                { type: "text" as const, text: request.user },
                ...request.images.flatMap((image) => [
                  ...(image.label ? [{ type: "text" as const, text: image.label }] : []),
                  { type: "image_url" as const, image_url: { url: image.dataUrl, detail: image.detail ?? "auto" } },
                ]),
              ]
            : request.user,
        },
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
