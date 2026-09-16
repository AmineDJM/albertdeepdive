import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

export const imageDescriptionSchema = z.object({
  description: z.string(),
  tags: z.array(z.string()),
  kind: z.enum(["photo", "logo", "screenshot", "diagram", "chart", "document"]),
});
export type ImageDescriptionOutput = z.infer<typeof imageDescriptionSchema>;

export type ImageDescriberInput = { fileName: string; width?: number | null; height?: number | null; caption?: string | null; context?: string | null };

/** Describes an image for alt text and tagging (never identifies people). */
export async function describeImage(input: ImageDescriberInput, ctx: AiServiceContext = {}) {
  return runService({
    service: "image_describer",
    schemaName: "image_description",
    schema: imageDescriptionSchema,
    input: { fileName: input.fileName, width: input.width ?? 0, height: input.height ?? 0, caption: input.caption ?? "", context: input.context ?? "" },
    ctx,
  });
}
