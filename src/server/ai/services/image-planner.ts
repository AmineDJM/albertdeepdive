import { z } from "zod";
import { runService, type AiServiceContext } from "./common";
import { IMAGE_OPERATIONS, IMAGE_TASKS, REFERENCE_ROLES, SENSITIVITIES } from "@/lib/images/types";

/**
 * The image planner: a person's sentence into a plan a model can be held to.
 *
 * It decides what changes, what must not, how carefully, which references help, and where in the
 * picture the change is. It writes the prompt too — but the rules that classify the subject set a
 * floor on its sensitivity, and the caller holds it there.
 */

export const imagePlanSchema = z.object({
  operation: z.enum(IMAGE_OPERATIONS),
  task: z.enum(IMAGE_TASKS),
  change: z.array(z.string()),
  preserve: z.array(z.string()),
  references: z.array(z.enum(REFERENCE_ROLES)),
  sensitivity: z.enum(SENSITIVITIES),
  region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable().optional(),
  output: z.enum(["raster", "vector"]),
  prompt: z.string(),
});
export type ImagePlanOutput = z.infer<typeof imagePlanSchema>;

export type ImagePlannerInput = {
  organizationName: string;
  instruction: string;
  isEdit: boolean;
  /** What is known about the picture being edited: its description, tags and kind. */
  subject: string;
  offered: string[];
  brand: string;
  /** The rules' own reading, so the model starts from the floor rather than from nothing. */
  floor: { operation: string; task: string; sensitivity: string; preserve: string[] };
};

export async function planImage(input: ImagePlannerInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "image_planner",
    schemaName: "image_edit_plan",
    schema: imagePlanSchema,
    tier: "STRONG",
    maxOutputTokens: 900,
    ctx,
    input: {
      organizationName: input.organizationName,
      instruction: input.instruction,
      mode: input.isEdit ? "edit an existing picture" : "make a new picture",
      subject: input.subject || "unknown",
      offered: input.offered.length ? input.offered.join(", ") : "none",
      brand: input.brand || "—",
      floorOperation: input.floor.operation,
      floorTask: input.floor.task,
      floorSensitivity: input.floor.sensitivity,
      floorPreserve: input.floor.preserve.join(", ") || "—",
      floor: input.floor,
    },
  });
}
