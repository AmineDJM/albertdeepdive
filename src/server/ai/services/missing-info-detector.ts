import { z } from "zod";
import { runService, severitySchema, type AiServiceContext } from "./common";

export const missingInfoSchema = z.object({
  items: z.array(z.object({ key: z.string(), label: z.string(), severity: severitySchema })),
});
export type MissingInfoOutput = z.infer<typeof missingInfoSchema>;

export type MissingInfoInput = {
  storyType: string;
  title: string;
  facts: { statement: string; category?: string | null }[];
  text: string;
  extra: Record<string, unknown>;
  mediaCount: number;
  mediaKinds: string[];
  quoteCount: number;
  urls: string[];
};

/** Lists what an editor should ask the contributor before the story can be written. */
export async function detectMissingInformation(input: MissingInfoInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "missing_info",
    schemaName: "missing_information",
    schema: missingInfoSchema,
    input: {
      storyType: input.storyType,
      title: input.title,
      factSheet: input.facts.length ? input.facts.map((f) => `- ${f.statement}${f.category ? ` [${f.category}]` : ""}`).join("\n") : "—",
      factList: input.facts,
      text: input.text,
      extra: input.extra,
      mediaCount: input.mediaCount,
      mediaNotes: input.mediaKinds.length ? input.mediaKinds.join(", ") : "none",
      mediaKinds: input.mediaKinds,
      quoteCount: input.quoteCount,
      urls: input.urls,
    },
    ctx,
  });
}
