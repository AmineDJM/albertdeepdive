import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";

/**
 * People putting themselves forward to write.
 *
 * Readers could sign themselves up and contributors could not: they arrived because an editor
 * typed them in or imported a spreadsheet, which is how a title ends up asking the same twenty
 * people for four years while the person who would have written the best piece in it never hears
 * about the thing at all.
 *
 * So a newsletter has a second public link. Somebody who follows it says who they are and which
 * newsletters they would write for, and lands in the contributor list — active, so the next
 * campaign can reach them, and recorded as having come through the form rather than from
 * somebody's address book.
 *
 * No double opt-in here, and deliberately: a contributor is not being subscribed to anything. They
 * will receive an invitation when an edition asks for one, and that invitation carries its own way
 * out. What the form does do is refuse to say whether an address is already known, for the same
 * reason the subscribe form does.
 *
 * There is no plan limit on this one because there is no plan limit on contributors: what a
 * workspace pays for is readers, editions, titles and seats. Inventing a cap here would refuse
 * somebody who wants to write for a reason nobody had decided.
 */

export const joinSchema = z.object({
  firstName: z.string().trim().min(1, "Tell us your first name").max(80),
  lastName: z.string().trim().min(1, "Tell us your last name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  organisationName: z.string().trim().max(120).optional(),
  preferredLanguage: z.enum(["en", "fr"]).default("fr"),
  publicationIds: z.array(z.uuid()).min(1, "Choose at least one newsletter"),
});
export type JoinInput = z.input<typeof joinSchema>;
export type JoinResult = { contributorId: string; created: boolean; titles: number };

/** The newsletter behind a `/c/…` link, when it is open to contributors. */
export async function publicationByJoinSlug(slug: string) {
  const publication = await db.query.publications.findFirst({
    where: and(eq(s.publications.joinSlug, slug), eq(s.publications.isPublic, true)),
    with: { organization: true },
  });
  if (!publication || publication.status === "ARCHIVED") return null;
  return publication;
}

/** Every newsletter of a workspace that takes contributors, for the shelf-wide link. */
export async function publicJoinShelf(organizationSlug: string) {
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, organizationSlug) });
  if (!organization) return null;
  const publications = await db.query.publications.findMany({
    where: and(eq(s.publications.organizationId, organization.id), eq(s.publications.isPublic, true)),
    orderBy: [asc(s.publications.sortOrder), asc(s.publications.name)],
  });
  const open = publications.filter((publication) => publication.status !== "ARCHIVED" && publication.joinSlug);
  return open.length ? { organization, publications: open } : null;
}

async function attach(contributorId: string, publicationIds: string[], source: string) {
  for (const publicationId of publicationIds) {
    await db
      .insert(s.publicationContributors)
      .values({ publicationId, contributorId, source })
      .onConflictDoNothing({ target: [s.publicationContributors.publicationId, s.publicationContributors.contributorId] });
  }
}

/** Put somebody on the contributor list from the public form, on the titles they ticked. */
export async function joinAsContributor(raw: JoinInput, meta?: { source?: string }): Promise<JoinResult> {
  const input = joinSchema.parse(raw);
  const chosen = await db.query.publications.findMany({ where: inArray(s.publications.id, input.publicationIds) });
  if (!chosen.length) throw new NotFoundError("Publication");
  const organizationId = chosen[0].organizationId;
  if (chosen.some((publication) => publication.organizationId !== organizationId)) throw new ValidationError("Those newsletters do not belong together");
  const open = chosen.filter((publication) => publication.isPublic && publication.status !== "ARCHIVED" && publication.joinSlug);
  if (!open.length) throw new ValidationError("Those newsletters are not looking for contributors");

  const existing = await db.query.contributors.findFirst({
    where: and(eq(s.contributors.organizationId, organizationId), eq(s.contributors.email, input.email)),
  });

  if (existing) {
    await db
      .update(s.contributors)
      .set({
        firstName: input.firstName || existing.firstName,
        lastName: input.lastName || existing.lastName,
        organisationName: input.organisationName || existing.organisationName,
        preferredLanguage: input.preferredLanguage,
        // Somebody who comes back and asks to write again is not hidden.
        isActive: true,
      })
      .where(eq(s.contributors.id, existing.id));
    await attach(existing.id, open.map((publication) => publication.id), meta?.source ?? "form");
    await audit({ action: "contributor.joined", organizationId, actorType: "SYSTEM", entityType: "CONTRIBUTOR", entityId: existing.id, metadata: { titles: open.length, existing: true } });
    return { contributorId: existing.id, created: false, titles: open.length };
  }

  const [created] = await db
    .insert(s.contributors)
    .values({
      organizationId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      organisationName: input.organisationName || null,
      preferredLanguage: input.preferredLanguage,
      type: "OTHER",
      isActive: true,
      tags: ["signed-up"],
    })
    .returning();
  await attach(created.id, open.map((publication) => publication.id), meta?.source ?? "form");
  await audit({ action: "contributor.joined", organizationId, actorType: "SYSTEM", entityType: "CONTRIBUTOR", entityId: created.id, metadata: { titles: open.length } });
  return { contributorId: created.id, created: true, titles: open.length };
}

/** Which newsletters each of these contributors writes for, for the list that shows it. */
export async function titlesForContributors(contributorIds: string[]): Promise<Map<string, string[]>> {
  if (!contributorIds.length) return new Map();
  const rows = await db
    .select({ contributorId: s.publicationContributors.contributorId, name: s.publications.name })
    .from(s.publicationContributors)
    .innerJoin(s.publications, eq(s.publications.id, s.publicationContributors.publicationId))
    .where(inArray(s.publicationContributors.contributorId, contributorIds));
  const out = new Map<string, string[]>();
  for (const row of rows) out.set(row.contributorId, [...(out.get(row.contributorId) ?? []), row.name]);
  return out;
}
