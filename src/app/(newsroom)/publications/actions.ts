"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { requirePermission } from "@/server/auth/session";
import { currentOrganizationId } from "@/server/tenancy/context";
import { audit } from "@/server/audit";
import { slugify } from "@/lib/utils";
import { NotFoundError, ValidationError, ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { OUTPUT_FORMATS } from "@/server/outputs/service";

const publicationSchema = z.object({
  name: z.string().trim().min(2, "Give the title a name").max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  language: z.enum(["en", "fr"]).default("en"),
  cadence: z.enum(["weekly", "fortnightly", "monthly", "quarterly", "irregular"]).default("monthly"),
  defaultFormats: z.array(z.enum(OUTPUT_FORMATS)).min(1, "Choose at least one format"),
  isPublic: z.boolean().default(true),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("ACTIVE"),
});

export type PublicationInput = z.input<typeof publicationSchema>;

/** Slugs are part of the public subscribe link, so they stay unique within the workspace. */
async function uniqueSlug(organizationId: string, name: string, excludeId?: string) {
  const base = slugify(name) || "title";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await db.query.publications.findFirst({
      where: excludeId
        ? and(eq(s.publications.organizationId, organizationId), eq(s.publications.slug, candidate), ne(s.publications.id, excludeId))
        : and(eq(s.publications.organizationId, organizationId), eq(s.publications.slug, candidate)),
      columns: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createPublicationAction(raw: PublicationInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("edition:create");
    const organizationId = await currentOrganizationId();
    const input = publicationSchema.parse(raw);
    const slug = await uniqueSlug(organizationId, input.name);
    const org = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { slug: true } });
    const [row] = await db
      .insert(s.publications)
      .values({
        organizationId,
        name: input.name,
        slug,
        description: input.description ?? null,
        language: input.language,
        cadence: input.cadence,
        defaultFormats: input.defaultFormats,
        isPublic: input.isPublic,
        status: input.status,
        subscribeSlug: `${org?.slug ?? "workspace"}-${slug}`,
        createdById: user.id,
      })
      .returning();
    await audit({ action: "publication.create", organizationId, userId: user.id, entityId: row.id, metadata: { name: input.name } });
    revalidatePath("/publications");
    return ok({ id: row.id });
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updatePublicationAction(id: string, raw: Partial<PublicationInput>): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:edit");
    const organizationId = await currentOrganizationId();
    const existing = await db.query.publications.findFirst({ where: and(eq(s.publications.id, id), eq(s.publications.organizationId, organizationId)) });
    if (!existing) throw new NotFoundError("Publication");
    const input = publicationSchema.partial().parse(raw);
    const patch: Record<string, unknown> = { ...input };
    if (input.name && input.name !== existing.name) patch.slug = await uniqueSlug(organizationId, input.name, id);
    await db.update(s.publications).set(patch).where(eq(s.publications.id, id));
    await audit({ action: "publication.update", organizationId, userId: user.id, entityId: id, metadata: { fields: Object.keys(patch) } });
    revalidatePath("/publications");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function deletePublicationAction(id: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("edition:create");
    const organizationId = await currentOrganizationId();
    const existing = await db.query.publications.findFirst({ where: and(eq(s.publications.id, id), eq(s.publications.organizationId, organizationId)) });
    if (!existing) throw new NotFoundError("Publication");
    // Deleting a title would orphan its editions and silently drop its subscribers. Archiving keeps
    // the archive readable and the record of who was reading it.
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.publicationId, id), columns: { id: true } });
    if (edition) throw new ValidationError("This title has editions. Archive it instead of deleting it.");
    await db.delete(s.publications).where(eq(s.publications.id, id));
    await audit({ action: "publication.delete", organizationId, userId: user.id, entityId: id, metadata: { name: existing.name } });
    revalidatePath("/publications");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
