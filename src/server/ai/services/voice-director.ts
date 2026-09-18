import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

/**
 * The voice director: a performance note and the few knobs a direction has, from a closed list.
 *
 * Deliberately a small, fast call. The base direction already says most of it; the model adds the
 * sentence that makes it about this edition rather than about editions in general, and prunes the
 * tag palette to what this material can carry.
 */

export const voiceDirectorSchema = z.object({
  stance: z.string(),
  energy: z.enum(["low", "medium", "high"]),
  pauses: z.enum(["few", "natural", "deliberate"]),
  tags: z.array(z.string()),
});
export type VoiceDirectorOutput = z.infer<typeof voiceDirectorSchema>;

export type VoiceDirectorInput = {
  organizationName: string;
  context: string;
  contextNotes: string;
  style: string;
  pace: string;
  tone: string[];
  languageName: string;
  tags: string[];
  excerpt: string;
  baseStance: string;
  baseEnergy: string;
  basePauses: string;
};

export async function directVoice(input: VoiceDirectorInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "voice_director",
    schemaName: "voice_direction",
    schema: voiceDirectorSchema,
    tier: "FAST",
    maxOutputTokens: 500,
    ctx,
    input: { ...input, tone: input.tone.length ? input.tone.join(", ") : "plain, confident", tags: input.tags.length ? input.tags.join(" ") : "none" },
  });
}
