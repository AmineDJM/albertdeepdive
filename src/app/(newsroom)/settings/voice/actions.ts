"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/server/auth/session";
import { requireOrganizationRole } from "@/server/tenancy/context";
import { updateBrandVoice, type BrandVoicePatch } from "@/server/speech/service";
import { RELATIONS, requestVoiceClone, revokeVoiceClone } from "@/server/speech/clones";
import { ok, toActionFailure, ValidationError, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

/** The house voice is the workspace's to set, so these are gated on the workspace role. */

export async function updateBrandVoiceAction(patch: BrandVoicePatch): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const tenant = await requireOrganizationRole("ADMIN");
    const user = await getCurrentUser();
    await updateBrandVoice(tenant.organizationId, patch, user?.id ?? null);
    revalidatePath("/settings/voice");
    return ok(null, tr("Voice saved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function requestVoiceCloneAction(form: FormData): Promise<ActionResult<{ status: string }>> {
  const tr = await getUi();
  try {
    const tenant = await requireOrganizationRole("ADMIN");
    const user = await getCurrentUser();
    if (!user) throw new ValidationError("Sign in again.");
    const relation = String(form.get("relation") ?? "other");
    if (!(RELATIONS as readonly string[]).includes(relation)) throw new ValidationError("Say who the person is.");
    const files = form.getAll("samples").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const samples = await Promise.all(files.map(async (file) => ({ bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type || "application/octet-stream" })));
    const row = await requestVoiceClone({
      organizationId: tenant.organizationId,
      name: String(form.get("name") ?? ""),
      personName: String(form.get("personName") ?? ""),
      relation: relation as (typeof RELATIONS)[number],
      language: String(form.get("language") ?? "") || null,
      consentText: String(form.get("consentText") ?? ""),
      consentConfirmed: form.get("consentConfirmed") === "on" || form.get("consentConfirmed") === "true",
      samples,
      actorId: user.id,
    });
    revalidatePath("/settings/voice");
    return ok({ status: row.status }, row.status === "READY" ? tr("The voice is ready to use.") : `${tr("The voice could not be made:")} ${row.error ?? ""}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function revokeVoiceCloneAction(cloneId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const tenant = await requireOrganizationRole("ADMIN");
    const user = await getCurrentUser();
    if (!user) throw new ValidationError("Sign in again.");
    await revokeVoiceClone(cloneId, tenant.organizationId, user.id);
    revalidatePath("/settings/voice");
    return ok(null, tr("Voice withdrawn and deleted at the provider."));
  } catch (err) {
    return toActionFailure(err);
  }
}
