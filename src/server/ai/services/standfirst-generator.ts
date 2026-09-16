import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const standfirstSchema = z.object({ standfirst: z.string() });
export type StandfirstOutput = z.infer<typeof standfirstSchema>;

/** Writes one 20–35 word standfirst that adds to the headline. */
export async function generateStandfirst(input: { headline: string; body: string }, ctx: AiServiceContext = {}) {
  return runService({ service: "standfirst_generator", schemaName: "standfirst", schema: standfirstSchema, input: { headline: input.headline, body: input.body }, ctx });
}
