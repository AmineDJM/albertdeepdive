"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/server/auth/session";
import { saveEditionSections, sectionInputSchema, updateEdition, updateEditionSchema } from "@/server/editions/service";
import { scheduleFromDefaults } from "@/server/campaigns/service";
import { ValidationError, ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

export type EditionSettingsPatch = {
  label: string;
  title: string;
  isSpecialIssue: boolean;
  pageSize: "A4" | "TABLOID" | "LETTER";
  targetPageCount: number;
  publicationTargetAt: string | null;
  finalReviewAt: string | null;
  editorInChiefId: string | null;
  coverHeadline: string | null;
  coverStandfirst: string | null;
  editorial: string | null;
  notes: string | null;
  theme: { coverTemplate?: string; accentColour?: string; tagline?: string };
};

export type EditionSectionPatch = {
  id?: string;
  slug: string;
  name: string;
  kicker: string | null;
  colour: string | null;
  isHidden: boolean;
  targetPages: number | null;
};

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) (out[issue.path.map(String).join(".") || "_form"] ??= []).push(issue.message);
  return out;
}

function revalidateEdition(editionId: string) {
  revalidatePath(`/editions/${editionId}/settings`);
  revalidatePath(`/editions/${editionId}`);
  revalidatePath(`/editions/${editionId}/layout`);
  revalidatePath("/editions");
}

export async function saveEditionSettingsAction(editionId: string, patch: EditionSettingsPatch): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("edition:edit");
    // Validate here so zod issues come back as field errors instead of a thrown ZodError.
    const parsed = updateEditionSchema.safeParse(patch);
    if (!parsed.success) throw new ValidationError("Please check the edition settings", fieldErrorsOf(parsed.error));
    await updateEdition(editionId, parsed.data, user.id);
    revalidateEdition(editionId);
    return ok(null, tr("Edition settings saved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function saveEditionSectionsAction(editionId: string, sections: EditionSectionPatch[]): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await requirePermission("section:manage");
    const parsed = z.array(sectionInputSchema).min(1, "Keep at least one section").safeParse(sections);
    if (!parsed.success) throw new ValidationError("Please check the section list", fieldErrorsOf(parsed.error));
    const saved = await saveEditionSections(editionId, parsed.data, user.id);
    revalidateEdition(editionId);
    revalidatePath(`/editions/${editionId}/stories`);
    return ok({ count: saved.length }, `${saved.length} section${saved.length === 1 ? "" : "s"} saved`);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Rebuilds this edition's campaign schedule (and its publication dates) from the monthly defaults. */
export async function applyMonthlyDefaultsAction(editionId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    await scheduleFromDefaults(editionId, user);
    revalidateEdition(editionId);
    revalidatePath(`/editions/${editionId}/campaign`);
    return ok(null, tr("Campaign schedule rebuilt from the monthly defaults"));
  } catch (err) {
    return toActionFailure(err);
  }
}
