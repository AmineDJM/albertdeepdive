import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const entitiesSchema = z.object({
  people: z.array(z.object({ name: z.string(), role: z.string() })),
  organisations: z.array(z.object({ name: z.string(), type: z.string() })),
  dates: z.array(z.object({ text: z.string(), iso: z.string().nullable() })),
  places: z.array(z.string()),
  metrics: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type EntitiesOutput = z.infer<typeof entitiesSchema>;

export type EntityExtractorInput = { text: string; knownOrganisations?: string[] };

/** Extracts people, organisations, dates, places and metrics that literally appear in the text. */
export async function extractSubmissionEntities(input: EntityExtractorInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "entity_extractor",
    schemaName: "entities",
    schema: entitiesSchema,
    input: { text: input.text, knownOrganisations: input.knownOrganisations ?? [] },
    ctx,
  });
}
