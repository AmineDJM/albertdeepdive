import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { scoped } from "@/server/tenancy/scope";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { createLogger } from "@/server/logger";
import type { EditionDocument } from "@/lib/publication/document";
import { describeEdition, readSignals, type EditionSignals } from "@/lib/design/signals";
import { planEdition, type DesignPlan } from "@/lib/design/plan";
import { describeDirection, type ResolvedDirection } from "@/lib/design/identity";
import type { Importance } from "@/lib/design/roles";
import { applyDirection, directEdition } from "@/server/ai/services/design-director";
import { artDirectionFor, directionFor, saveArtDirection } from "./identity";

const logger = createLogger("design:director");

/**
 * Reading an edition, deciding what it is, and planning it — in that order.
 *
 * The order is the whole point. §79 of the design brief asks for a plan before a render, because a
 * composer working story by story produces something correct with no rhythm: a stack of identical
 * blocks, which is precisely what an edition must not look like.
 *
 * The model is asked for judgement and nothing else. If it is unavailable, misconfigured, slow or
 * wrong, what remains is the arithmetic and the rules — and those produce a publication, not an
 * error message. A design that is merely good beats a dialog box, every time.
 */

export type DirectedEdition = {
  document: EditionDocument;
  signals: EditionSignals;
  direction: ResolvedDirection;
  plan: DesignPlan;
  /** Whether the judgement came from a model or from the material alone. */
  source: "model" | "local";
  /** What it cost, for the platform's ledger. Never shown to a customer. */
  costCents: number;
};

export type DirectOptions = {
  /** What the editor said, when they said anything. */
  steer?: string | null;
  /** Skip the model entirely — used by the golden tests, which must be deterministic. */
  local?: boolean;
  userId?: string | null;
};

export async function directEditionDesign(editionId: string, options: DirectOptions = {}): Promise<DirectedEdition> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition) throw new Error(`Edition ${editionId} not found`);
  // Unapproved articles included: an edition is designed while it is being written, and a design
  // that only sees approved copy would leave half the issue out of its own plan.
  const [document, resolved] = await Promise.all([
    buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true }),
    directionFor(editionId),
  ]);
  const signals = readSignals(document);

  let overrides: ReadonlyMap<string, Importance> | undefined;
  let source: DirectedEdition["source"] = "local";
  let costCents = 0;
  let narrative = describeEdition(signals);
  let decisions: { decision: string; because: string }[] = [];
  let direction = resolved.resolved;

  if (!options.local) {
    try {
      const organization = edition.organizationId ? await db.query.organizations.findFirst({ where: eq(s.organizations.id, edition.organizationId) }) : null;
      const publication = edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId) }) : null;
      const result = await directEdition(
        {
          organizationName: organization?.name ?? "the organisation",
          publicationName: publication?.name ?? edition.title,
          editionLabel: edition.label,
          signals,
          direction,
          steer: options.steer ?? null,
        },
        { editionId, entityType: "EDITION", entityId: editionId, tier: "STRONG" },
      );
      const applied = applyDirection(result.output, signals);
      overrides = applied.overrides;
      source = "model";
      costCents = result.usage.costCents;
      narrative = result.output.narrative;
      if (applied.ignored.length) logger.warn("the director named stories that are not in this edition", { editionId, ignored: applied.ignored });

      // What the director decided is saved as this issue's art direction, which is what makes it
      // visible to the editor, to the conversation and to the next revision.
      const existing = await artDirectionFor(editionId);
      const dials = result.output.dials ?? null;
      await saveArtDirection(
        editionId,
        {
          narrative,
          mood: result.output.mood ?? existing.mood,
          cover: result.output.cover ?? existing.cover,
          genome: {
            ...existing.genome,
            ...(dials?.density !== null && dials?.density !== undefined ? { density: dials.density } : {}),
            ...(dials?.colourIntensity !== null && dials?.colourIntensity !== undefined ? { colourIntensity: dials.colourIntensity } : {}),
            ...(dials?.imageUsage ? { imageUsage: dials.imageUsage } : {}),
            ...(dials?.typographicVoice ? { typographicVoice: dials.typographicVoice } : {}),
            ...(dials?.variation !== null && dials?.variation !== undefined ? { variation: dials.variation } : {}),
          },
        },
        { userId: options.userId ?? null },
      );
      // Re-resolve: the director may have moved a dial, and the plan must be built from what it said.
      direction = (await directionFor(editionId)).resolved;
      decisions = result.output.emphasis.map((item) => ({ decision: `“${signals.stories.find((story) => story.articleId === item.articleId)?.headline ?? item.articleId}” is ${item.importance.toLowerCase()}`, because: item.because }));
    } catch (err) {
      // Deliberately quiet for the customer and loud for us: the edition still gets designed.
      logger.warn("no direction from the model; composing from the material", { editionId, err });
    }
  }

  const plan = planEdition(editionId, signals, direction, overrides);
  return {
    document,
    signals,
    direction,
    plan: { ...plan, narrative, decisions: [...decisions, ...plan.decisions], source },
    source,
    costCents,
  };
}

/** The sentence an editor reads while this is happening, in their words rather than the engine's. */
export function statusFor(stage: "reading" | "directing" | "planning" | "composing"): string {
  switch (stage) {
    case "reading":
      return "Reading the edition…";
    case "directing":
      return "Deciding what this issue is…";
    case "planning":
      return "Planning the pages…";
    case "composing":
      return "Designing the edition…";
  }
}

/** What the director decided, for the screen that explains it. */
export function explain(directed: DirectedEdition): { narrative: string; direction: string; decisions: { decision: string; because: string }[] } {
  return {
    narrative: directed.plan.narrative,
    direction: describeDirection(directed.direction),
    decisions: directed.plan.decisions,
  };
}
