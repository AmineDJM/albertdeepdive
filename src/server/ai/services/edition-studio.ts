import { z } from "zod";
import { editionOperationSchema } from "@/server/editorial/edition-studio/operations";
import { runService, type AiServiceContext } from "./common";

/**
 * The studio's planner: a sentence about an issue becomes operations against that issue.
 *
 * It returns prose *and* a plan, and the prose is the part a person reads. The plan is checked
 * against the vocabulary before anything runs, so the worst a confused — or steered — model can do
 * is propose something the executor refuses by name.
 */
export const studioPlanSchema = z.object({
  /** What the assistant says back, in the language the person wrote in. */
  reply: z.string().min(1),
  /** What it intends to do. Empty is a perfectly good answer to a question. */
  operations: z.array(editionOperationSchema).max(12),
  /** Set when what it proposes is heavy enough to want reading twice; the vocabulary marks those too. */
  askFirst: z.boolean(),
});
export type StudioPlan = z.infer<typeof studioPlanSchema>;

export type StudioPlanInput = {
  /** The issue as measured and counted, already rendered for the prompt. */
  snapshot: string;
  /** Earlier turns, oldest first, already trimmed to what is worth remembering. */
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  /** Photographs dropped in with this message, so "add these" has something to name. */
  attachedMedia: { id: string; fileName: string; caption: string | null }[];
  /** What is already in the revision and not yet applied, so it can change its mind rather than repeat itself. */
  waiting: unknown[];
};

export async function planEditionChange(input: StudioPlanInput, ctx: AiServiceContext = {}) {
  const history = input.history.map((h) => `${h.role === "user" ? "Person" : "Briefly"}: ${h.content}`).join("\n");
  const attached = input.attachedMedia.length
    ? input.attachedMedia.map((m) => `${m.id} · ${m.fileName} · ${m.caption ?? "no caption"}`).join("\n")
    : "none";
  return runService({
    service: "edition_studio",
    schemaName: "studio_plan",
    schema: studioPlanSchema,
    input: {
      snapshot: input.snapshot,
      history: history || "(this is the first message)",
      message: input.message,
      attachedMedia: attached,
      waiting: input.waiting.length ? JSON.stringify(input.waiting) : "nothing yet",
    },
    ctx,
    maxOutputTokens: 2500,
  });
}
