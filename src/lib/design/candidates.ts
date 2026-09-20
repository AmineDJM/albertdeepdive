import { addressOf, blocksOf, findBlock, mayChange, withBlock, type EditionDesign } from "./model";
import { candidatesFor, compositionSpread, recomposeBlock } from "./compose";
import { COMPOSITIONS, IMPORTANCE_WEIGHT, type BlockRole } from "./roles";
import { inspectDesign, SEVERITIES, type DesignFinding } from "./critic";
import type { EditionSignals } from "./signals";
import type { ResolvedDirection } from "./identity";

/**
 * More than one way to do it, and a reason for the one chosen.
 *
 * §41: never ship the first valid layout. The first valid layout is the one the composer happened
 * to reach first, which is a function of the order the stories arrived in — and an engine that
 * ships it is an engine whose output has no reason behind it beyond "it worked".
 *
 * So a candidate is a whole design with one thing done differently, scored against the same critic
 * that judges the issue. What the score cannot see is whether it *looks* better; that is what the
 * tournament is for, and this is what the tournament is given to look at.
 */

export type Candidate = {
  id: string;
  design: EditionDesign;
  /** What is different about this one, in words: "the lead as a full-width image". */
  label: string;
  score: number;
  /** Why it scored what it scored, for the console and for the person who asks. */
  why: string;
  /** True for the design as it already is, which is always one of the options. */
  current: boolean;
};

export type CandidateContext = { signals: EditionSignals; direction: ResolvedDirection };

/**
 * How good a design is, as far as arithmetic can tell.
 *
 * Deliberately blunt. It is a filter, not a judgement: it throws out the candidates that are
 * broken or monotonous so that the expensive judgement — looking at them — is spent on the ones
 * that are actually in contention.
 */
export function scoreDesign(design: EditionDesign, ctx: CandidateContext): { score: number; why: string; findings: DesignFinding[] } {
  const findings = inspectDesign({ design, signals: ctx.signals, direction: ctx.direction });
  const blocks = Math.max(6, blocksOf(design).length);
  /*
   * Blocking and soft findings are counted differently on purpose.
   *
   * A blocking finding is categorical — a composition no renderer draws is not "slightly worse" —
   * so each one costs a fixed and large amount. Everything else is a rate: a forty-block issue
   * with six things worth mentioning is a better issue than a six-block one with the same six, and
   * a score that simply adds them up sends every real edition to zero, where nothing can be
   * compared with anything.
   */
  const blocking = findings.filter((finding) => finding.severity === "BLOCKING").length;
  const soft = findings.filter((finding) => finding.severity !== "BLOCKING").reduce((total, finding) => total + [0, 0.12, 0.03][SEVERITIES.indexOf(finding.severity)], 0);
  const penalty = Math.min(0.8, blocking * 0.4) + Math.min(0.35, soft / (blocks / 6));

  const spread = compositionSpread(design);
  // Variety, as a share of the compositions this issue could have used. A publication drawing one
  // shape over and over scores badly however clean each instance is.
  const variety = spread.blocks ? Math.min(1, spread.used / Math.max(3, Math.min(spread.blocks, 8))) : 0;

  const weights = blocksOf(design).filter((block) => block.articleId).map((block) => IMPORTANCE_WEIGHT[block.importance]);
  const hierarchy = weights.length > 1 ? Math.min(1, (Math.max(...weights) - Math.min(...weights)) / 0.7) : 0;

  const score = Math.max(0, Math.min(1, 0.55 + 0.25 * variety + 0.2 * hierarchy - penalty));
  const why = [
    `${Math.round(variety * 100)}% of the variety it could have`,
    `${Math.round(hierarchy * 100)}% of the hierarchy`,
    findings.length ? `${findings.length} finding${findings.length === 1 ? "" : "s"}` : "nothing found against it",
  ].join(", ");
  return { score: Math.round(score * 1000) / 1000, why, findings };
}

/**
 * The legitimate ways one block could be drawn instead, as whole designs.
 *
 * Whole designs rather than blocks on purpose: a layout is only better or worse *in an issue*, and
 * a composition that reads well on its own can be the fourth identical one in a row.
 */
export function candidatesForBlock(design: EditionDesign, blockId: string, ctx: CandidateContext, limit = 3): Candidate[] {
  const block = findBlock(design, blockId);
  if (!block) return [];
  const base = scoreDesign(design, ctx);
  const current: Candidate = { id: `${blockId}:current`, design, label: `as it is: ${block.composition.replace(/-/g, " ")}`, score: base.score, why: base.why, current: true };
  if (!mayChange(block, "composition")) return [current];

  const story = block.articleId ? (ctx.signals.stories.find((candidate) => candidate.articleId === block.articleId) ?? null) : null;
  const usable = candidatesFor(block.role as BlockRole, {
    story,
    importance: block.importance,
    direction: ctx.direction,
    recent: [],
    density: ctx.direction.genome.density,
  }).filter((composition) => composition !== block.composition);

  const sectionId = addressOf(design, blockId)?.sectionId ?? null;
  const others = usable.map((composition) => {
    const next = withBlock(design, blockId, (candidate) => recomposeBlock(candidate, { signals: ctx.signals, direction: ctx.direction, sectionId, force: composition }));
    const scored = scoreDesign(next, ctx);
    return { id: `${blockId}:${composition}`, design: next, label: composition.replace(/-/g, " "), score: scored.score, why: scored.why, current: false };
  });

  return [current, ...others].sort(byScore).slice(0, Math.max(1, limit));
}

/** The same, for a whole surface: every block on it redrawn one way or another. */
export function candidatesForSurface(design: EditionDesign, surfaceId: string, ctx: CandidateContext, limit = 3): Candidate[] {
  const surface = design.sections.flatMap((section) => section.surfaces).find((candidate) => candidate.id === surfaceId);
  if (!surface) return [];
  const base = scoreDesign(design, ctx);
  const current: Candidate = { id: `${surfaceId}:current`, design, label: "as it is", score: base.score, why: base.why, current: true };

  // Each pass gives every unlocked block on the surface a different composition, so the options are
  // whole arrangements rather than one block changed three times.
  const options: Candidate[] = [];
  for (let pass = 1; pass <= Math.max(1, limit - 1); pass += 1) {
    let next = design;
    const changed: string[] = [];
    for (const block of surface.blocks) {
      if (!mayChange(block, "composition")) continue;
      const sectionId = addressOf(design, block.id)?.sectionId ?? null;
      const story = block.articleId ? (ctx.signals.stories.find((candidate) => candidate.articleId === block.articleId) ?? null) : null;
      const usable = candidatesFor(block.role as BlockRole, { story, importance: block.importance, direction: ctx.direction, recent: [], density: ctx.direction.genome.density }).filter(
        (composition) => composition !== block.composition,
      );
      const wanted = usable[(pass - 1) % Math.max(1, usable.length)];
      if (!wanted) continue;
      next = withBlock(next, block.id, (candidate) => recomposeBlock(candidate, { signals: ctx.signals, direction: ctx.direction, sectionId, force: wanted }));
      changed.push(wanted.replace(/-/g, " "));
    }
    if (!changed.length) break;
    const scored = scoreDesign(next, ctx);
    options.push({ id: `${surfaceId}:pass-${pass}`, design: next, label: changed.join(", "), score: scored.score, why: scored.why, current: false });
  }

  return [current, ...dedupe(options)].sort(byScore).slice(0, Math.max(1, limit));
}

/**
 * The covers this issue could have.
 *
 * §82 asks for a cover tournament specifically, and a cover is the one page where the approach —
 * not the composition — is the decision: the same photograph led with, set aside, or not used at
 * all is three different magazines.
 */
export function coverCandidates(design: EditionDesign, ctx: CandidateContext, limit = 4): Candidate[] {
  const cover = blocksOf(design).find((block) => block.role === "cover");
  if (!cover) return [];
  const approaches = COMPOSITIONS.cover.filter((approach) => approach !== cover.composition);
  const base = scoreDesign(design, ctx);
  const current: Candidate = { id: "cover:current", design, label: `as it is: ${cover.composition.replace(/-/g, " ")}`, score: base.score, why: base.why, current: true };
  if (!mayChange(cover, "composition")) return [current];

  const story = cover.articleId ? (ctx.signals.stories.find((candidate) => candidate.articleId === cover.articleId) ?? null) : null;
  const possible = candidatesFor("cover", { story, importance: cover.importance, direction: ctx.direction, recent: [], density: ctx.direction.genome.density });
  const sectionId = addressOf(design, cover.id)?.sectionId ?? null;

  const others = approaches
    .filter((approach) => possible.includes(approach))
    .map((approach) => {
      const next = withBlock(design, cover.id, (candidate) => recomposeBlock(candidate, { signals: ctx.signals, direction: ctx.direction, sectionId, force: approach }));
      const scored = scoreDesign(next, ctx);
      return { id: `cover:${approach}`, design: next, label: approach.replace(/-/g, " "), score: scored.score, why: scored.why, current: false };
    });

  return [current, ...others].sort(byScore).slice(0, Math.max(1, limit));
}

function byScore(a: Candidate, b: Candidate): number {
  if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
  // A tie goes to the one that is already there: churn without a reason is not a design decision.
  return Number(b.current) - Number(a.current);
}

function dedupe(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.label)) return false;
    seen.add(candidate.label);
    return true;
  });
}
