"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { requireOrganizationRole } from "@/server/tenancy/context";
import { organizationTypes, updateOrganization } from "@/server/tenancy/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

const workspaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(organizationTypes),
  website: z.string().trim().url().optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional(),
  locale: z.enum(["en", "fr"]),
  timezone: z.string().trim().min(1),
  country: z.string().trim().max(80).optional(),
  logoUrl: z.string().trim().url().optional().or(z.literal("")),
  primary: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
});

export type WorkspaceInput = z.input<typeof workspaceSchema>;

export async function saveWorkspaceAction(raw: WorkspaceInput): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const tenant = await requireOrganizationRole("ADMIN");
    const input = workspaceSchema.parse(raw);
    await updateOrganization(
      tenant.organizationId,
      {
        name: input.name,
        type: input.type,
        website: input.website || undefined,
        description: input.description || undefined,
        locale: input.locale,
        timezone: input.timezone,
        country: input.country || undefined,
        logoUrl: input.logoUrl || null,
        brandColours: { primary: input.primary || undefined, accent: input.accent || undefined },
      },
      user.id,
    );
    revalidatePath("/settings/workspace");
    revalidatePath("/", "layout");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
