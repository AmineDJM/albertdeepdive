"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { requireOrganizationRole } from "@/server/tenancy/context";
import { getOrganization, updateOrganization } from "@/server/tenancy/service";
import { organizationTypes } from "@/lib/tenancy/types";
import { discoverOrganization, type DiscoveredOrganization } from "@/server/tenancy/discovery";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

const optionalUrl = z.string().trim().url().optional().or(z.literal(""));

const workspaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(organizationTypes),
  website: optionalUrl,
  description: z.string().trim().max(2000).optional(),
  locale: z.enum(["en", "fr"]),
  timezone: z.string().trim().min(1),
  country: z.string().trim().max(80).optional(),
  logoUrl: optionalUrl,
  faviconUrl: optionalUrl,
  primary: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  // What the organisation is, beyond what Briefly needs to send a newsletter. Every one of these
  // is optional and every one is typed by hand if the reading pass got it wrong or found nothing.
  legalName: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(120).optional(),
  headline: z.string().trim().max(300).optional(),
  foundedYear: z.string().trim().regex(/^\d{4}$/).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  telephone: z.string().trim().max(60).optional(),
  address: z.string().trim().max(300).optional(),
  linkedin: optionalUrl,
  instagram: optionalUrl,
  x: optionalUrl,
  youtube: optionalUrl,
  facebook: optionalUrl,
});

export type WorkspaceInput = z.input<typeof workspaceSchema>;

export async function saveWorkspaceAction(raw: WorkspaceInput): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const tenant = await requireOrganizationRole("ADMIN");
    const input = workspaceSchema.parse(raw);
    const year = Number(input.foundedYear);
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
        faviconUrl: input.faviconUrl || null,
        brandColours: { primary: input.primary || undefined, accent: input.accent || undefined },
        links: {
          website: input.website || undefined,
          linkedin: input.linkedin || undefined,
          instagram: input.instagram || undefined,
          x: input.x || undefined,
          youtube: input.youtube || undefined,
          facebook: input.facebook || undefined,
        },
        profile: {
          legalName: input.legalName || undefined,
          industry: input.industry || undefined,
          headline: input.headline || undefined,
          foundedYear: Number.isFinite(year) && year > 1000 ? year : undefined,
          email: input.email || undefined,
          telephone: input.telephone || undefined,
          address: input.address || undefined,
        },
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

/**
 * Read the organisation's website again, with a real browser.
 *
 * Returns a proposal and writes nothing. What comes back goes next to what is already saved, the
 * customer keeps whichever is right, corrects whatever is wrong, and presses Save — which is the
 * only thing that changes the workspace. A reading pass that silently overwrote somebody's own
 * words because their marketing site changed would be worse than no reading pass at all.
 *
 * The address may be the one being typed into the form rather than the one on file, so that
 * somebody who has just corrected their website does not have to save it before it can be read.
 */
export async function rereadWebsiteAction(website?: string): Promise<ActionResult<DiscoveredOrganization>> {
  try {
    await requireUser();
    const tenant = await requireOrganizationRole("ADMIN");
    const organization = await getOrganization(tenant.organizationId);
    const address = (website ?? "").trim() || organization.website;
    if (!address) return toActionFailure(new Error("Add your website first, then read it."));
    return ok(await discoverOrganization(address));
  } catch (err) {
    return toActionFailure(err);
  }
}
