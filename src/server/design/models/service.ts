import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { activeBrand } from "@/server/brand/service";
import { activeGenome, activeIdentity, saveIdentity } from "@/server/design/identity";
import { DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { brandGenomeSchema, editorialGenomeSchema, nearestMood, type DesignMood } from "@/lib/design/genome";
import { resolveDirection, type PublicationIdentity } from "@/lib/design/identity";
import { MODEL_ORDER, MODEL_PERSONALITY, isModelKey, modelGenome, specimenFor, type ModelKey, type Specimen } from "@/lib/design/models";
import type { PersonalityKey } from "@/lib/brand/typography";

/**
 * The shelf of models a title can be made on.
 *
 * Two kinds, and the difference is worth keeping visible. The **brand** model is composed from this
 * workspace's own colours, type and genome — there is exactly one and it is different for every
 * customer. The six **generic** ones are Briefly's, the same everywhere, and are offered because
 * plenty of organisations have a logo and no opinion about editorial design, which is a perfectly
 * reasonable place to start from.
 *
 * All of them are drawn through the same `resolveDirection` the renderers use, so the gallery
 * cannot quietly disagree with what the engine would set. A model that looked one way on this
 * screen and another on the page would be worse than no gallery.
 */

export type ModelCard = {
  /** `brand`, or one of the six moods. */
  id: string;
  kind: "brand" | "briefly";
  mood: DesignMood;
  personality: PersonalityKey;
  specimen: Specimen;
  /** True when the title is already made on this one. */
  current: boolean;
};

export type ModelShelf = {
  publicationId: string;
  publicationName: string;
  colours: { brand: string; accent: string; ink: string; paper: string };
  cards: ModelCard[];
};

async function publicationFor(publicationId: string) {
  const publication = await db.query.publications.findFirst({
    where: await scoped(s.publications.organizationId, eq(s.publications.id, publicationId)),
    columns: { id: true, name: true, organizationId: true },
  });
  if (!publication) throw new NotFoundError("Publication");
  return publication;
}

/** Which model a title is on today, so the gallery can mark it rather than ask. */
function currentModelId(identity: PublicationIdentity | null): string | null {
  if (!identity) return null;
  const source = identity.source?.kind ?? null;
  if (source === "brand") return "brand";
  if (source === "briefly") {
    // A Briefly model is stored as a whole genome, so the mood it is nearest to *is* the model.
    // Parsed rather than cast: a patch saved by an older version may be missing a dial, and
    // `nearestMood` compares all of them.
    const chosen = identity.genome ?? {};
    return Object.keys(chosen).length ? nearestMood(editorialGenomeSchema.parse(chosen)) : null;
  }
  return null;
}

export async function modelShelf(publicationId: string): Promise<ModelShelf> {
  const publication = await publicationFor(publicationId);
  const [brandRow, genome, identity] = await Promise.all([
    activeBrand(publication.organizationId).catch(() => null),
    activeGenome(publication.organizationId),
    activeIdentity(publicationId).catch(() => null),
  ]);
  const system = ((brandRow?.system as BrandSystem | undefined) ?? DEFAULT_BRAND_SYSTEM) as BrandSystem;
  const colours = {
    brand: system.colours.brand,
    accent: system.colours.accent,
    ink: system.colours.ink,
    paper: system.colours.paper,
  };

  // The workspace's own, composed rather than listed: its dials are the brand's, its type is the
  // brand's, and its mood is whatever those dials come out nearest to.
  const brandDirection = resolveDirection(genome, null, null);
  const brandCard: ModelCard = {
    id: "brand",
    kind: "brand",
    mood: brandDirection.mood,
    personality: system.personality as PersonalityKey,
    specimen: specimenFor(brandDirection, system.personality as PersonalityKey),
    current: false,
  };

  const generic: ModelCard[] = MODEL_ORDER.map((key) => {
    // Each generic model is read as if it were the whole genome, which is what adopting it does.
    const direction = resolveDirection(brandGenomeSchema.parse({ editorial: modelGenome(key) }), null, null);
    return {
      id: key,
      kind: "briefly" as const,
      mood: key,
      personality: MODEL_PERSONALITY[key],
      specimen: specimenFor(direction, MODEL_PERSONALITY[key]),
      current: false,
    };
  });

  const current = currentModelId(identity);
  const cards = [brandCard, ...generic].map((card) => ({ ...card, current: card.id === current }));
  return { publicationId, publicationName: publication.name, colours, cards };
}

/**
 * Make a title on one of these.
 *
 * The rubrics a title runs are its own — read out of a file somebody uploaded, or named by them —
 * and changing what the pages *look* like is not a reason to throw away what they are *called*. So
 * the rubrics and the recurring pieces survive; the genome, the type pairing and the source change.
 */
export async function adoptModel(publicationId: string, modelId: string, userId?: string | null): Promise<PublicationIdentity> {
  const publication = await publicationFor(publicationId);
  const current = await activeIdentity(publicationId);

  if (modelId === "brand") {
    const [brandRow, genome] = await Promise.all([activeBrand(publication.organizationId).catch(() => null), activeGenome(publication.organizationId)]);
    const system = ((brandRow?.system as BrandSystem | undefined) ?? DEFAULT_BRAND_SYSTEM) as BrandSystem;
    return saveIdentity(
      publicationId,
      {
        ...current,
        // Nothing of its own: the title reads the organisation's genome straight through, which is
        // what "made on your brand" means.
        genome: {},
        personality: system.personality as PublicationIdentity["personality"],
        coverStyle: genome.editorial.imageUsage === "sparse" ? "typographic" : "image-led",
        source: { kind: "brand", fileName: null, summary: "", confidence: null, readBy: "measured", at: new Date().toISOString() },
      },
      { userId, reason: "Made on the workspace brand" },
    );
  }

  if (!isModelKey(modelId)) throw new ValidationError("That is not one of Briefly's models.", { model: [modelId] });
  const key: ModelKey = modelId;
  return saveIdentity(
    publicationId,
    {
      ...current,
      genome: modelGenome(key),
      personality: MODEL_PERSONALITY[key],
      source: { kind: "briefly", fileName: null, summary: "", confidence: null, readBy: "measured", at: new Date().toISOString() },
    },
    { userId, reason: `Made on Briefly's ${key} model` },
  );
}
