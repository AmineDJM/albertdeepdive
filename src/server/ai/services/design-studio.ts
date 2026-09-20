import { z } from "zod";
import { designOperationSchema } from "@/lib/design/operations";
import { runService, type AiServiceContext } from "./common";

/**
 * Talking to a design: a sentence becomes operations against *this* design.
 *
 * It returns prose and a plan, and the prose is the part a person reads. The plan is checked
 * against the vocabulary and then against the design itself, so the worst a confused — or steered —
 * model can do is propose something the executor refuses by name.
 *
 * What it must not do is guess. "Make it pop" is not a design instruction, and a system that
 * silently turns it into four operations has invented an intention nobody had. The schema has a
 * field for asking, and the prompt says to use it.
 */
export const designPlanSchema = z.object({
  /** What Briefly says back, in the language the person wrote in. */
  reply: z.string().min(1),
  /** What it intends to do. Empty is a perfectly good answer to a question about the design. */
  operations: z.array(designOperationSchema).max(10),
  /** Set when what it proposes is heavy enough to want reading twice. */
  askFirst: z.boolean(),
  /**
   * What it needs to know before it can do anything.
   *
   * Null when the sentence was clear. A question here is not a failure: half of art direction is
   * finding out what somebody meant by "quieter".
   */
  question: z.string().max(300).nullable(),
});
export type DesignPlan = z.infer<typeof designPlanSchema>;

export type DesignPlanInput = {
  /** The design as it stands, already written out for the prompt. */
  design: string;
  /** What the publication is trying to be, so "quieter" is judged against its own intent. */
  intent: string;
  /** The blocks the person has selected, if any: "this" means these. */
  selection: string;
  /** Earlier turns, oldest first. */
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  /** Compositions each role in this design may be drawn in, so a proposal is a real one. */
  vocabulary: string;
};

export async function planDesignChange(input: DesignPlanInput, ctx: AiServiceContext = {}) {
  const history = input.history.map((turn) => `${turn.role === "user" ? "Person" : "Briefly"}: ${turn.content}`).join("\n");
  return runService({
    service: "design_studio",
    schemaName: "design_plan",
    schema: designPlanSchema,
    tier: "STRONG",
    maxOutputTokens: 2000,
    input: {
      design: input.design,
      intent: input.intent,
      selection: input.selection || "nothing is selected",
      history: history || "(this is the first message)",
      message: input.message,
      vocabulary: input.vocabulary,
    },
    ctx,
  });
}
