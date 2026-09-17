"use server";

import { z } from "zod";
import { db } from "@/server/db/client";
import { publications } from "@/server/db/schema";
import { requireUser } from "@/server/auth/session";
import { discoverOrganization, type DiscoveredOrganization } from "@/server/tenancy/discovery";
import { createOrganization, organizationTypes, updateOrganization } from "@/server/tenancy/service";
import { ensureBrand } from "@/server/brand/service";
import { setActiveOrganization } from "@/server/tenancy/context";
import { slugify } from "@/lib/utils";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

/** Step 1 — read the website and show what we found. Nothing is written yet. */
export async function discoverAction(_prev: ActionResult<DiscoveredOrganization> | null, formData: FormData): Promise<ActionResult<DiscoveredOrganization>> {
  try {
    await requireUser();
    const website = String(formData.get("website") ?? "");
    return ok(await discoverOrganization(website));
  } catch (err) {
    return toActionFailure(err);
  }
}

const confirmSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(120),
  type: z.enum(organizationTypes),
  website: z.string().trim().url().optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional(),
  locale: z.enum(["en", "fr"]),
  timezone: z.string().trim().min(1),
  publicationName: z.string().trim().min(2, "Give your publication a name").max(120),
  logoUrl: z.string().trim().url().optional().or(z.literal("")),
  faviconUrl: z.string().trim().url().optional().or(z.literal("")),
  colours: z.string().optional(),
  fonts: z.string().optional(),
  links: z.string().optional(),
});

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Step 2 — create the workspace and its first publication, then switch into it.
 *
 * A workspace with no publication is a dead end: there is nowhere to put an edition, so every
 * screen would be empty. Creating both together means the newsroom is usable the moment onboarding
 * finishes.
 */
export async function confirmOnboardingAction(_prev: ActionResult<{ organizationId: string }> | null, formData: FormData): Promise<ActionResult<{ organizationId: string }>> {
  try {
    const user = await requireUser();
    const input = confirmSchema.parse(Object.fromEntries(formData));
    const colours = parseJson<string[]>(input.colours, []);
    const fonts = parseJson<string[]>(input.fonts, []);
    const links = parseJson<Record<string, string>>(input.links, {});

    const org = await createOrganization(
      {
        name: input.name,
        type: input.type,
        website: input.website || undefined,
        description: input.description || undefined,
        locale: input.locale,
        timezone: input.timezone,
      },
      user.id,
    );

    if (colours.length || Object.keys(links).length || input.logoUrl || input.faviconUrl) {
      await updateOrganization(
        org.id,
        {
          brandColours: { primary: colours[0], accent: colours[1], palette: colours },
          links,
          logoUrl: input.logoUrl || null,
          faviconUrl: input.faviconUrl || null,
        },
        user.id,
      );
    }

    // The brand is built from the same evidence the confirmation screen showed, so what the customer
    // just approved is what every renderer will use. Discovery is not repeated: the site may have
    // changed between the two steps, and agreeing to one thing and getting another is not onboarding.
    await ensureBrand(org.id, { colours, fonts, logoUrl: input.logoUrl || null, type: input.type });

    const slug = slugify(input.publicationName) || "edition";
    await db.insert(publications).values({
      organizationId: org.id,
      name: input.publicationName,
      slug,
      language: input.locale,
      defaultFormats: ["EMAIL", "WEB"],
      cadence: "monthly",
      subscribeSlug: `${org.slug}-${slug}`,
      createdById: user.id,
    });

    await setActiveOrganization(org.id);
    return ok({ organizationId: org.id });
  } catch (err) {
    return toActionFailure(err);
  }
}
