"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/auth/session";
import { ok, toActionFailure, ValidationError, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";
import { RECURRING_COMPONENTS } from "@/lib/design/identity";
import { blueprintEvidenceSchema } from "@/lib/design/blueprint";
import { adoptBlueprint, proposeFromBrand, proposeFromFile, type BlueprintProposal } from "@/server/design/blueprint/service";

/** A newsletter somebody sends us is somebody's actual file; 25 MB is a generous print PDF. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Reading a model, designing one, and adopting it.
 *
 * Nothing is written until the last of the three. A person who uploads last month's newsletter has
 * not yet agreed to anything: they get a reading, on screen, that they can look at and throw away.
 * That separation is the whole reason this is three actions rather than one — "upload and it is
 * done" is how somebody's title silently becomes something they did not choose.
 */
export async function readBlueprintAction(formData: FormData): Promise<ActionResult<BlueprintProposal>> {
  try {
    await requirePermission("layout:edit");
    const publicationId = String(formData.get("publicationId") ?? "");
    const file = formData.get("file");
    if (!publicationId) throw new ValidationError("Which newsletter is this for?");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a file to read");
    if (file.size > MAX_BYTES) throw new ValidationError("That file is too large (25 MB maximum)");
    return ok(await proposeFromFile(publicationId, Buffer.from(await file.arrayBuffer()), file.name));
  } catch (err) {
    return toActionFailure(err);
  }
}

const rubricInputSchema = z.array(z.object({ name: z.string().trim().min(1).max(60), component: z.enum(RECURRING_COMPONENTS).nullable() })).max(12);

export async function designFromBrandAction(publicationId: string, rubrics: z.input<typeof rubricInputSchema>): Promise<ActionResult<BlueprintProposal>> {
  try {
    await requirePermission("layout:edit");
    return ok(await proposeFromBrand(publicationId, rubricInputSchema.parse(rubrics)));
  } catch (err) {
    return toActionFailure(err);
  }
}

/*
 * What comes back from the browser is checked again before it is written.
 *
 * The proposal made the round trip through a screen, so it is input now rather than something this
 * server computed a moment ago. Everything in it is a design setting the person is entitled to
 * change by hand anyway — the point is not that they might cheat, it is that a malformed shape must
 * not reach the identity and break every render afterwards.
 */
const proposalSchema = z.object({
  kind: z.string().max(20),
  fileName: z.string().max(200).nullable(),
  evidence: blueprintEvidenceSchema,
  identity: z.record(z.string(), z.unknown()),
  rubrics: z.array(z.object({ name: z.string().trim().min(1).max(60), purpose: z.string().max(160).default(""), component: z.enum(RECURRING_COMPONENTS).nullable() })).max(12),
  brand: z.unknown().nullable(),
  summary: z.string().max(600),
  confidence: z.enum(["high", "medium", "low"]),
  readBy: z.enum(["model", "measured"]),
  notes: z.array(z.string()).max(20),
});

export async function adoptBlueprintAction(publicationId: string, proposal: unknown): Promise<ActionResult<{ version: number }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("layout:edit");
    const parsed = proposalSchema.parse(proposal) as unknown as BlueprintProposal;
    const identity = await adoptBlueprint(publicationId, parsed, user.id);
    revalidatePath(`/publications/${publicationId}`);
    revalidatePath(`/publications/${publicationId}/blueprint`);
    return ok({ version: identity.version }, tr("Your newsletter will be made on this from now on"));
  } catch (err) {
    return toActionFailure(err);
  }
}
