import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { activeBrand } from "@/server/brand/service";
import { DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { brandGenomeSchema, correctGenome, genomeFromBrand, genomePatchSchema, type BrandGenome, type GenomePatch, type GenomeSource } from "@/lib/design/genome";
import { artDirectionSchema, newArtDirection, newIdentity, publicationIdentitySchema, resolveDirection, type EditionArtDirection, type PublicationIdentity, type ResolvedDirection } from "@/lib/design/identity";

/**
 * Reading and writing what an organisation, a title and an issue look like.
 *
 * Every read here answers with something usable. A workspace that has never been asked about its
 * genome still gets one — read from its brand, marked as read rather than stated — because a design
 * engine that refuses to compose until somebody fills in a form is a design engine nobody reaches.
 * The same goes for a title with no identity and an issue with no direction.
 *
 * Writes are the opposite: explicit, attributed, and versioned where the thing they change outlives
 * the edit.
 */

/** The organisation's genome, read from its brand when nobody has said otherwise. */
export async function activeGenome(organizationId: string): Promise<BrandGenome> {
  const row = await db.query.brandGenomes.findFirst({
    where: and(eq(s.brandGenomes.organizationId, organizationId), eq(s.brandGenomes.isActive, true)),
  });
  if (row) return brandGenomeSchema.parse(row.genome);
  const brand = await activeBrand(organizationId).catch(() => null);
  return genomeFromBrand((brand?.system as BrandSystem | undefined) ?? DEFAULT_BRAND_SYSTEM);
}

/**
 * A correction to the genome, which outranks whatever was read from the brand.
 *
 * The previous active row is retired rather than updated: what Briefly believed last month is part
 * of why last month's issue looks as it does.
 */
export async function setGenome(organizationId: string, patch: GenomePatch, options: { userId?: string | null; source?: GenomeSource } = {}): Promise<BrandGenome> {
  const parsed = genomePatchSchema.parse(patch);
  const current = await activeGenome(organizationId);
  const next = correctGenome(current, parsed, options.source ?? "user");
  await db.transaction(async (tx) => {
    await tx.update(s.brandGenomes).set({ isActive: false, updatedAt: new Date() }).where(and(eq(s.brandGenomes.organizationId, organizationId), eq(s.brandGenomes.isActive, true)));
    await tx.insert(s.brandGenomes).values({ organizationId, genome: next, isActive: true, createdById: options.userId ?? null });
  });
  return next;
}

/** A title's identity, or the one it would have if nobody had ever opened the screen. */
export async function activeIdentity(publicationId: string): Promise<PublicationIdentity> {
  const row = await db.query.publicationIdentities.findFirst({
    where: await scoped(s.publicationIdentities.organizationId, eq(s.publicationIdentities.publicationId, publicationId), eq(s.publicationIdentities.isActive, true)),
  });
  if (row) return publicationIdentitySchema.parse(row.identity);
  const publication = await db.query.publications.findFirst({ where: await scoped(s.publications.organizationId, eq(s.publications.id, publicationId)) });
  return newIdentity(publicationId, publication?.name ?? "Publication");
}

/**
 * A new version of a title's identity.
 *
 * Versions rather than edits, because an edition records which version it was composed under and a
 * published issue must stay reproducible. `reason` is required in spirit even where the type allows
 * null: a design change nobody can explain is one nobody can undo with confidence.
 */
export async function saveIdentity(publicationId: string, patch: Partial<PublicationIdentity>, options: { userId?: string | null; reason?: string } = {}): Promise<PublicationIdentity> {
  const publication = await db.query.publications.findFirst({ where: await scoped(s.publications.organizationId, eq(s.publications.id, publicationId)) });
  if (!publication?.organizationId) throw new Error(`Publication ${publicationId} not found`);
  const current = await activeIdentity(publicationId);
  const next = publicationIdentitySchema.parse({
    ...current,
    ...patch,
    id: current.id,
    publicationId,
    version: current.version + 1,
    genome: { ...current.genome, ...(patch.genome ?? {}) },
    updatedAt: new Date().toISOString(),
  });
  await db.transaction(async (tx) => {
    await tx.update(s.publicationIdentities).set({ isActive: false }).where(and(eq(s.publicationIdentities.publicationId, publicationId), eq(s.publicationIdentities.isActive, true)));
    await tx.insert(s.publicationIdentities).values({ organizationId: publication.organizationId!, publicationId, version: next.version, identity: next, reason: options.reason ?? null, isActive: true, createdById: options.userId ?? null });
  });
  return next;
}

/** Every version of a title's identity, newest first — the evidence behind "it has always looked like this". */
export async function identityHistory(publicationId: string, limit = 20) {
  return db.query.publicationIdentities.findMany({
    where: await scoped(s.publicationIdentities.organizationId, eq(s.publicationIdentities.publicationId, publicationId)),
    orderBy: [desc(s.publicationIdentities.version)],
    limit,
  });
}

/** This issue's art direction, or an empty one that inherits everything from the title. */
export async function artDirectionFor(editionId: string): Promise<EditionArtDirection> {
  const row = await db.query.editionArtDirections.findFirst({
    where: await scoped(s.editionArtDirections.organizationId, eq(s.editionArtDirections.editionId, editionId)),
  });
  return row ? artDirectionSchema.parse(row.direction) : newArtDirection(editionId);
}

/**
 * Save this issue's direction.
 *
 * One row per edition, replaced in place: the history worth keeping is the designs that followed
 * from it, not every adjustment of the sentence that produced them. A direction a person stated is
 * marked as theirs, which is what stops a later inference overruling it.
 */
export async function saveArtDirection(editionId: string, patch: Partial<EditionArtDirection>, options: { userId?: string | null; stated?: boolean } = {}): Promise<EditionArtDirection> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition?.organizationId) throw new Error(`Edition ${editionId} not found`);
  const current = await artDirectionFor(editionId);
  const source: EditionArtDirection["source"] = options.stated ? (current.source === "inferred" && current.narrative ? "mixed" : "user") : current.source;
  const next = artDirectionSchema.parse({
    ...current,
    ...patch,
    id: current.id,
    editionId,
    genome: { ...current.genome, ...(patch.genome ?? {}) },
    source,
  });
  const existing = await db.query.editionArtDirections.findFirst({
    where: await scoped(s.editionArtDirections.organizationId, eq(s.editionArtDirections.editionId, editionId)),
  });
  if (existing) {
    await db.update(s.editionArtDirections).set({ direction: next, updatedAt: new Date() }).where(eq(s.editionArtDirections.id, existing.id));
  } else {
    await db.insert(s.editionArtDirections).values({ organizationId: edition.organizationId, editionId, direction: next, createdById: options.userId ?? null });
  }
  return next;
}

/**
 * Everything the composer needs for one edition, resolved.
 *
 * The single entry point: brand, title and issue read once, resolved once, so no part of the engine
 * can accidentally consult two of the three and compose against a fourth thing.
 */
export async function directionFor(editionId: string): Promise<{ resolved: ResolvedDirection; genome: BrandGenome; identity: PublicationIdentity | null; direction: EditionArtDirection }> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition) throw new Error(`Edition ${editionId} not found`);
  const [genome, direction] = await Promise.all([activeGenome(edition.organizationId!), artDirectionFor(editionId)]);
  const identity = edition.publicationId ? await activeIdentity(edition.publicationId) : null;
  return { resolved: resolveDirection(genome, identity, direction), genome, identity, direction };
}
