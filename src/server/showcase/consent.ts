import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { showableEditions } from "./service";

/**
 * Who said a title may be shown in the public gallery.
 *
 * Consent is its own path, not a field on the title's editor, because it is the one setting whose
 * mistake is visible to the whole internet. Every change is audited with who made it and how, and
 * the customer can withdraw at any moment from the same screen that granted it — including consent
 * a super admin recorded, which is what makes "we have permission" checkable rather than a claim.
 */

export type ShowcaseStatus = {
  publicationId: string;
  name: string;
  consent: (typeof s.showcaseConsentEnum.enumValues)[number];
  note: string | null;
  consentAt: Date | null;
  /** Editions that would actually appear: published, with a public web address. */
  showable: number;
  /** Collections a curator has put them in. */
  collections: { slug: string; title: string }[];
};

/** The customer's own decision, for one of their titles. */
export async function setCustomerConsent(organizationId: string, publicationId: string, on: boolean, userId?: string | null) {
  const publication = await db.query.publications.findFirst({ where: and(eq(s.publications.id, publicationId), eq(s.publications.organizationId, organizationId)) });
  if (!publication) throw new NotFoundError("Publication");
  // A customer turning it off clears a permission a super admin recorded too: their work, their call.
  const [row] = await db
    .update(s.publications)
    .set({ showcaseConsent: on ? "CUSTOMER" : "NONE", showcaseNote: on ? publication.showcaseNote : null, showcaseConsentAt: new Date(), showcaseConsentById: userId ?? null })
    .where(eq(s.publications.id, publicationId))
    .returning();
  await audit({ action: on ? "showcase.consent.granted" : "showcase.consent.withdrawn", organizationId, userId, entityType: "SETTING", entityId: publicationId, metadata: { publication: publication.name, by: "customer" } });
  return row;
}

/**
 * The platform's decision, which is narrower on purpose.
 *
 * `PLATFORM_DEMO` is only for workspaces Briefly owns — there is no customer to ask, because there
 * is no customer. `PERMISSION` is for a real customer who agreed somewhere else, and it requires a
 * note saying where, so the claim is recorded rather than remembered. Neither can be used to put a
 * customer's work in the gallery on nobody's word.
 */
export async function setPlatformConsent(publicationId: string, consent: "NONE" | "PLATFORM_DEMO" | "PERMISSION", note: string | null, userId?: string | null) {
  const publication = await db.query.publications.findFirst({ where: eq(s.publications.id, publicationId) });
  if (!publication) throw new NotFoundError("Publication");
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, publication.organizationId), columns: { id: true, name: true, isDemo: true } });
  if (consent === "PLATFORM_DEMO" && !organization?.isDemo) {
    throw new ValidationError("Only a Briefly demo workspace can be shown as a demo. For a customer, record their permission instead.", { consent: ["Not a demo workspace"] });
  }
  if (consent === "PERMISSION" && !note?.trim()) {
    throw new ValidationError("Say where the permission was given — an email, a contract, a date.", { note: ["Required"] });
  }
  const [row] = await db
    .update(s.publications)
    .set({ showcaseConsent: consent, showcaseNote: consent === "NONE" ? null : (note?.trim() ?? null), showcaseConsentAt: new Date(), showcaseConsentById: userId ?? null })
    .where(eq(s.publications.id, publicationId))
    .returning();
  await audit({ action: consent === "NONE" ? "showcase.consent.withdrawn" : "showcase.consent.granted", organizationId: publication.organizationId, userId, entityType: "SETTING", entityId: publicationId, metadata: { publication: publication.name, consent, note: note ?? null, by: "platform" } });
  return row;
}

/** What a customer sees about their own presence in the gallery. */
export async function showcaseStatusFor(organizationId: string): Promise<ShowcaseStatus[]> {
  const publications = await db.query.publications.findMany({ where: eq(s.publications.organizationId, organizationId), orderBy: [s.publications.sortOrder, s.publications.name] });
  if (!publications.length) return [];
  const editions = await db.select({ id: s.editions.id, publicationId: s.editions.publicationId }).from(s.editions).where(eq(s.editions.organizationId, organizationId));
  const allowed = new Set((await showableEditions({ editionIds: editions.map((e) => e.id) })).map((e) => e.editionId));
  const inCollections = await db
    .select({ editionId: s.collectionItems.editionId, slug: s.collections.slug, title: s.collections.title })
    .from(s.collectionItems)
    .innerJoin(s.collections, eq(s.collections.id, s.collectionItems.collectionId))
    .where(and(inArray(s.collectionItems.editionId, editions.map((e) => e.id).length ? editions.map((e) => e.id) : ["00000000-0000-0000-0000-000000000000"]), eq(s.collections.isPublished, true)));
  const editionPublication = new Map(editions.map((e) => [e.id, e.publicationId]));
  return publications.map((publication) => {
    const mine = editions.filter((e) => e.publicationId === publication.id);
    const seen = new Map<string, { slug: string; title: string }>();
    for (const row of inCollections) if (editionPublication.get(row.editionId) === publication.id) seen.set(row.slug, { slug: row.slug, title: row.title });
    return {
      publicationId: publication.id,
      name: publication.name,
      consent: publication.showcaseConsent,
      note: publication.showcaseNote,
      consentAt: publication.showcaseConsentAt,
      showable: mine.filter((e) => allowed.has(e.id)).length,
      collections: [...seen.values()],
    };
  });
}

/** Every title a curator could draw from, for the console's picker. */
export async function consentingPublications() {
  return db
    .select({
      id: s.publications.id,
      name: s.publications.name,
      consent: s.publications.showcaseConsent,
      note: s.publications.showcaseNote,
      organization: s.organizations.name,
      organizationId: s.organizations.id,
      isDemo: s.organizations.isDemo,
      editions: sql<number>`(select count(*) from ${s.editions} where ${s.editions.publicationId} = ${s.publications.id})`,
    })
    .from(s.publications)
    .innerJoin(s.organizations, eq(s.organizations.id, s.publications.organizationId))
    .orderBy(s.organizations.name, s.publications.name);
}
