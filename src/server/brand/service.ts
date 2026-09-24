import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { ValidationError } from "@/lib/action-result";
import { requireTenant } from "@/server/tenancy/context";
import { brandFromEvidence, type BrandEvidence, type BrandOrigin } from "@/lib/brand/discover";
import { brandSystemSchema, compileBrandSystem, contrastReport, DEFAULT_BRAND_SYSTEM, TONE_WORDS, type BrandSystem, type BrandTokens } from "@/lib/brand/system";

/**
 * A workspace's brand, read and written.
 *
 * Every renderer in Briefly — email, web, magazine, print, and everything the Creative Studio makes
 * — starts here. That is the point of the table: one identity, compiled the same way for every
 * surface, so an organisation's magazine and its carousel are recognisably the same organisation
 * rather than two designs that happen to share a logo.
 *
 * Reads are cheap and frequent, so `brandFor` returns the compiled tokens and callers never see the
 * raw document unless they are editing it.
 */

export type BrandRecord = typeof s.brandSystems.$inferSelect;

/** The organisation's own brand — never one of its newsletters'. */
export async function activeBrand(organizationId: string): Promise<BrandRecord | null> {
  return (
    (await db.query.brandSystems.findFirst({
      where: and(eq(s.brandSystems.organizationId, organizationId), isNull(s.brandSystems.publicationId), eq(s.brandSystems.isActive, true)),
    })) ?? null
  );
}

/** A newsletter's own brand, when it has one. */
export async function activePublicationBrand(publicationId: string): Promise<BrandRecord | null> {
  return (await db.query.brandSystems.findFirst({ where: and(eq(s.brandSystems.publicationId, publicationId), eq(s.brandSystems.isActive, true)) })) ?? null;
}

/**
 * The brand a newsletter wears: its own when it was read from its own address, its organisation's
 * otherwise. Every renderer of an edition asks this rather than the organisation directly, so a
 * newsletter dressed differently from its sender is dressed that way everywhere it goes out.
 */
export async function brandRecordFor(scope: { organizationId: string; publicationId?: string | null }): Promise<BrandRecord> {
  const own = scope.publicationId ? await activePublicationBrand(scope.publicationId) : null;
  return own ?? ensureBrand(scope.organizationId);
}

/** The compiled tokens a newsletter is rendered in. */
export async function brandForPublication(scope: { organizationId: string; publicationId?: string | null }): Promise<BrandTokens> {
  return compileBrandSystem((await brandRecordFor(scope)).system);
}

/**
 * Give a newsletter its own brand, from what was read off its own address.
 *
 * Built on the organisation's brand rather than from nothing: whatever the reading found (the
 * colours, the type, the mark) replaces the organisation's, and whatever it did not find is the
 * organisation's still, so a page that yields only a logo does not turn every colour to a default.
 * Versioned like any brand; the previous one stays as history.
 */
export async function savePublicationBrandFromEvidence(input: {
  organizationId: string;
  publicationId: string;
  evidence: BrandEvidence;
  source: string;
  actorId?: string | null;
}): Promise<BrandRecord> {
  const base = (await ensureBrand(input.organizationId)).system;
  const discovered = brandFromEvidence(input.evidence);
  const origin = discovered.origin;
  const system: BrandSystem = {
    ...base,
    colours: {
      ...base.colours,
      ...(origin.brand === "discovered" ? { brand: discovered.system.colours.brand } : {}),
      ...(origin.accent === "discovered" ? { accent: discovered.system.colours.accent } : {}),
      ...(origin.paper === "discovered" ? { paper: discovered.system.colours.paper } : {}),
    },
    personality: origin.personality === "discovered" ? discovered.system.personality : base.personality,
    imagery: origin.personality === "discovered" ? discovered.system.imagery : base.imagery,
    logo: origin.logo === "discovered" ? { ...base.logo, markUrl: discovered.system.logo.markUrl } : base.logo,
  };
  const parsed = brandSystemSchema.parse(system);

  const previous = await activePublicationBrand(input.publicationId);
  const record = await db.transaction(async (tx) => {
    if (previous) await tx.update(s.brandSystems).set({ isActive: false, updatedAt: new Date() }).where(eq(s.brandSystems.id, previous.id));
    const [created] = await tx
      .insert(s.brandSystems)
      .values({
        organizationId: input.organizationId,
        publicationId: input.publicationId,
        name: "Newsletter",
        system: parsed,
        origin,
        notes: [`Read from ${input.source}`, ...discovered.notes.filter((note) => !note.startsWith("We could not read any colours") || origin.brand !== "discovered")],
        createdById: input.actorId ?? null,
      })
      .returning();
    return created;
  });
  await audit({
    action: "brand.publication.read",
    entityType: "SETTING",
    entityId: record.id,
    userId: input.actorId ?? null,
    organizationId: input.organizationId,
    metadata: { publicationId: input.publicationId, source: input.source, brand: parsed.colours.brand, logo: !!parsed.logo.markUrl },
  });
  return record;
}

/**
 * The voice a newsletter is written in, changed where it is read.
 *
 * A newsletter with a look of its own gets a new version of that look with the new tone; one
 * wearing its organisation's changes the organisation's, which is the voice it was already
 * borrowing. Either way it is a new version, so what was written before keeps its record.
 */
export async function setVoiceTone(input: { organizationId: string; publicationId?: string | null; tone: string[]; actorId?: string | null }): Promise<BrandRecord> {
  const tone = [...new Set(input.tone)].filter((word): word is (typeof TONE_WORDS)[number] => (TONE_WORDS as readonly string[]).includes(word)).slice(0, 3);
  if (!tone.length) throw new ValidationError("Choose at least one word for the tone", { tone: ["Choose at least one"] });
  const own = input.publicationId ? await activePublicationBrand(input.publicationId) : null;
  if (!own) {
    const record = await ensureBrand(input.organizationId);
    return saveBrand({ organizationId: input.organizationId, system: { ...record.system, voice: { ...record.system.voice, tone } }, actorId: input.actorId });
  }
  const system = brandSystemSchema.parse({ ...own.system, voice: { ...own.system.voice, tone } });
  const record = await db.transaction(async (tx) => {
    await tx.update(s.brandSystems).set({ isActive: false, updatedAt: new Date() }).where(eq(s.brandSystems.id, own.id));
    const [created] = await tx
      .insert(s.brandSystems)
      .values({ organizationId: own.organizationId, publicationId: own.publicationId, name: own.name, system, origin: own.origin, notes: own.notes, createdById: input.actorId ?? null })
      .returning();
    return created;
  });
  await audit({ action: "brand.tone", entityType: "SETTING", entityId: record.id, userId: input.actorId ?? null, organizationId: input.organizationId, metadata: { publicationId: input.publicationId, tone } });
  return record;
}

/** Back to the organisation's brand: the newsletter's own is kept as history, no longer worn. */
export async function clearPublicationBrand(publicationId: string): Promise<void> {
  await db.update(s.brandSystems).set({ isActive: false, updatedAt: new Date() }).where(and(eq(s.brandSystems.publicationId, publicationId), eq(s.brandSystems.isActive, true)));
}

/**
 * The brand system for a workspace, creating the default one the first time it is asked for.
 *
 * Lazy rather than created at onboarding, because a workspace that predates this table still needs
 * to work, and because a row nobody has looked at is a row that can be wrong for months. The first
 * read makes it real.
 */
export async function ensureBrand(organizationId: string, evidence?: BrandEvidence): Promise<BrandRecord> {
  const existing = await activeBrand(organizationId);
  if (existing) return existing;

  const discovered = evidence ? brandFromEvidence(evidence) : null;
  const [created] = await db
    .insert(s.brandSystems)
    .values({
      organizationId,
      system: discovered?.system ?? DEFAULT_BRAND_SYSTEM,
      origin: discovered?.origin ?? {},
      notes: discovered?.notes ?? [],
    })
    // Two requests can race to create the first brand; the partial unique index decides, and the
    // loser reads what the winner wrote rather than failing.
    .onConflictDoNothing()
    .returning();
  return created ?? (await activeBrand(organizationId))!;
}

/** The compiled tokens, which is what every renderer actually wants. */
export async function brandFor(organizationId: string): Promise<BrandTokens> {
  const record = await ensureBrand(organizationId);
  return compileBrandSystem(record.system);
}

export async function brandForTenant(): Promise<BrandTokens> {
  const tenant = await requireTenant();
  return brandFor(tenant.organizationId);
}

/**
 * Replace the active brand with a new version.
 *
 * The old row stays, deactivated: anything already rendered was rendered in those colours, and being
 * able to say which is the difference between reproducing an artefact and approximating it. Both
 * writes go in one transaction, so there is never a moment with two active brands or none.
 */
export async function saveBrand(input: { organizationId: string; system: unknown; name?: string; actorId?: string | null }): Promise<BrandRecord> {
  const parsed = brandSystemSchema.safeParse(input.system);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "system";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new ValidationError("That brand is not valid", fieldErrors);
  }

  const previous = await activeBrand(input.organizationId);
  const record = await db.transaction(async (tx) => {
    if (previous) await tx.update(s.brandSystems).set({ isActive: false, updatedAt: new Date() }).where(eq(s.brandSystems.id, previous.id));
    const [created] = await tx
      .insert(s.brandSystems)
      .values({
        organizationId: input.organizationId,
        name: input.name?.trim() || previous?.name || "Brand",
        system: parsed.data,
        // Anything a person edited is theirs now, whatever discovery originally thought.
        origin: previous ? markEdited(previous.system, parsed.data, previous.origin) : {},
        notes: [],
        createdById: input.actorId ?? null,
      })
      .returning();
    return created;
  });

  await audit({
    action: "brand.save",
    entityType: "SETTING",
    entityId: record.id,
    userId: input.actorId ?? null,
    organizationId: input.organizationId,
    metadata: { personality: parsed.data.personality, brand: parsed.data.colours.brand },
  });
  return record;
}

/** Which discovered fields the customer has since overruled. */
function markEdited(before: BrandSystem, after: BrandSystem, origin: Partial<Record<string, BrandOrigin>>): Partial<Record<string, BrandOrigin>> {
  const next = { ...origin };
  for (const key of ["brand", "accent", "ink", "paper"] as const) {
    if (before.colours[key] !== after.colours[key]) next[key] = "default";
  }
  if (before.personality !== after.personality) next.personality = "default";
  if (before.logo.markUrl !== after.logo.markUrl) next.logo = "default";
  return next;
}

/**
 * Re-read the brand from the organisation's website.
 *
 * Returns a proposal rather than applying it. Overwriting somebody's identity because a marketing
 * page changed its hero colour would be a surprise, and a surprise about your own brand is the worst
 * kind — so the editor shows what changed and the customer decides.
 */
export function proposeFromEvidence(evidence: BrandEvidence) {
  const discovered = brandFromEvidence(evidence);
  return { ...discovered, tokens: compileBrandSystem(discovered.system) };
}

/** Every text/background pair the renderer can produce, for the brand editor's accessibility panel. */
export async function brandContrast(organizationId: string) {
  return contrastReport(await brandFor(organizationId));
}
