import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { NotFoundError } from "@/lib/action-result";
import { buildEditionDocument } from "@/server/publication/document-builder";
import type { EditionDesign } from "@/lib/design/model";
import { COMPOSITIONS, type BlockRole } from "@/lib/design/roles";
import { describeDirection, type ResolvedDirection } from "@/lib/design/identity";
import { describeGrid } from "@/lib/design/grid";
import { readSignals } from "@/lib/design/signals";
import { candidatesFor } from "@/lib/design/compose";
import { describeFindings, inspectDesign, ranked, type DesignFinding } from "@/lib/design/critic";
import { currentDesign, designHistory } from "./service";
import { directionFor } from "./identity";
import { listDesignTurns, type DesignTurn } from "./studio";

/**
 * Everything the design screen needs, read once.
 *
 * The screen is the whole point of the engine: §28 asks for the high-level controls to come first
 * and the advanced ones to be available, §30 for direct manipulation, §32 for a conversation, §40
 * for a history. All of those are views of the same three things — the design, what the critic
 * thinks of it, and what has been said about it — so they are read together rather than by four
 * round trips that can disagree with each other.
 */

export type DesignBlockView = {
  id: string;
  role: string;
  composition: string;
  importance: string;
  /** The ways this block could legitimately be drawn instead, given its own material. */
  alternatives: string[];
  locked: boolean;
  lockedAspects: string[];
  headline: string | null;
  hasPicture: boolean;
  /** Why it is drawn this way, in one line. */
  rationale: string | null;
  sectionName: string;
  surfaceId: string;
};

export type DesignDials = {
  mood: string;
  density: number;
  colourIntensity: number;
  ornament: number;
  variation: number;
  minimalism: number;
  typographicVoice: string;
  imageUsage: string;
  cover: string;
};

export type DesignState = {
  editionId: string;
  /** Null when this edition has never been designed. The screen offers to design it. */
  design: EditionDesign | null;
  revision: number | null;
  /** What the direction resolves to, and the sentence that explains it. */
  dials: DesignDials;
  intent: string;
  grid: string;
  blocks: DesignBlockView[];
  findings: DesignFinding[];
  verdict: string;
  history: { revision: number; summary: string | null; isCurrent: boolean; createdAt: string }[];
  turns: DesignTurn[];
};

export async function designState(editionId: string): Promise<DesignState> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition) throw new NotFoundError("Edition");

  const [design, { resolved: direction }, history, turns] = await Promise.all([
    currentDesign(editionId),
    directionFor(editionId),
    designHistory(editionId, 20),
    listDesignTurns(editionId, 40),
  ]);

  const dials = dialsOf(direction);
  const base = {
    editionId,
    design,
    revision: design?.revision ?? null,
    dials,
    intent: describeDirection(direction),
    grid: describeGrid(direction.grid),
    history: history.map((row) => ({ revision: row.revision, summary: row.summary, isCurrent: row.isCurrent, createdAt: row.createdAt.toISOString() })),
    turns,
  };
  if (!design) return { ...base, blocks: [], findings: [], verdict: "This edition has not been designed yet." };

  const document = await buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true });
  const signals = readSignals(document);
  const headlines = new Map(document.articles.map((article) => [article.id, article.headline]));
  const findings = ranked(inspectDesign({ design, signals, direction }));

  const blocks: DesignBlockView[] = [];
  for (const section of design.sections) {
    for (const surface of section.surfaces) {
      for (const block of surface.blocks) {
        const story = block.articleId ? (signals.stories.find((candidate) => candidate.articleId === block.articleId) ?? null) : null;
        blocks.push({
          id: block.id,
          role: block.role,
          composition: block.composition,
          importance: block.importance,
          // What this block could be instead, worked out from its own material rather than from a
          // menu: a composition that needs a photograph is not an option for a story without one.
          alternatives: candidatesFor(block.role as BlockRole, { story, importance: block.importance, direction, recent: [], density: direction.genome.density })
            .filter((candidate) => candidate !== block.composition)
            .slice(0, 5),
          locked: block.locked,
          lockedAspects: block.lockedAspects,
          headline: block.articleId ? (headlines.get(block.articleId) ?? null) : null,
          hasPicture: block.elements.some((element) => element.content.kind === "media"),
          rationale: block.rationale,
          sectionName: section.name,
          surfaceId: surface.id,
        });
      }
    }
  }

  return { ...base, blocks, findings, verdict: describeFindings(findings) };
}

function dialsOf(direction: ResolvedDirection): DesignDials {
  return {
    mood: direction.mood,
    density: direction.genome.density,
    colourIntensity: direction.genome.colourIntensity,
    ornament: direction.genome.ornament,
    variation: direction.genome.variation,
    minimalism: direction.genome.minimalism,
    typographicVoice: direction.genome.typographicVoice,
    imageUsage: direction.genome.imageUsage,
    cover: direction.cover,
  };
}

/** Every composition a role may be drawn in, for the screen that offers them. */
export function compositionsFor(role: string): readonly string[] {
  return COMPOSITIONS[role as BlockRole] ?? [];
}
