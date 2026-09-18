import type { ImageEditPlan, ImageQa } from "./types";
import { hammingDistance } from "@/server/media/hash";

/**
 * Is this picture the one that was asked for?
 *
 * Two kinds of evidence. The numbers: how much the picture changed against the one before it,
 * from the perceptual hashes — a "replace only the plant" that changed half the frame did not do
 * what it was told, and a "make it warmer" that changed nothing did not either. And, when a model
 * that can see is connected, its reading of the picture: adherence, fidelity, artifacts. The
 * numbers set a floor a vision model cannot talk its way past.
 */

export type VisionVerdict = { adherence: number; fidelity: number; quality: number; issues: string[]; unwantedChanges: string[] };

export type AssessInput = {
  plan: ImageEditPlan;
  before: { phash: string | null } | null;
  after: { phash: string | null; width: number; height: number };
  vision?: VisionVerdict | null;
  /** Below this the picture is thrown out; up to `retryBelow` it is tried again. */
  passAt?: number;
  retryBelow?: number;
};

/** A perceptual hash has 64 bits; the share that flipped is the share of the picture that changed. */
export function changeRatio(before: string | null, after: string | null): number | null {
  if (!before || !after || before.length !== after.length) return null;
  return Math.round((hammingDistance(before, after) / (before.length * 4)) * 1000) / 1000;
}

export function assessImage(input: AssessInput): ImageQa {
  const passAt = input.passAt ?? 0.7;
  const retryBelow = input.retryBelow ?? 0.45;
  const issues: string[] = [];
  const change = input.before ? changeRatio(input.before.phash, input.after.phash) : null;
  let score = 0.8;

  if (input.after.width < 256 || input.after.height < 256) {
    issues.push("The picture came back too small to use.");
    score = 0.1;
  }

  if (input.plan.operation !== "generate" && change !== null) {
    if (input.plan.operation === "localized_edit" && change > 0.45) {
      issues.push("Far more of the picture changed than the edit asked for.");
      score -= input.plan.sensitivity === "HIGH" ? 0.5 : 0.3;
    } else if (input.plan.sensitivity === "HIGH" && change > 0.6) {
      issues.push("Protected parts of the picture appear to have changed.");
      score -= 0.4;
    }
    if (change < 0.02) {
      issues.push("Nothing seems to have changed.");
      score -= 0.35;
    }
  }

  let method: ImageQa["method"] = "heuristic";
  let adherence: number | null = null;
  let fidelity: number | null = null;
  if (input.vision) {
    method = "vision";
    adherence = clamp(input.vision.adherence);
    fidelity = clamp(input.vision.fidelity);
    const quality = clamp(input.vision.quality);
    // The seen verdict decides most of the score; the numbers above still subtract what they found.
    const weightFidelity = input.plan.sensitivity === "HIGH" ? 0.45 : 0.25;
    const seen = adherence * (0.75 - weightFidelity) + fidelity * weightFidelity + quality * 0.25;
    score = Math.min(score, seen) + Math.min(0, score - 0.8);
    issues.push(...input.vision.issues.slice(0, 6));
    if (input.vision.unwantedChanges.length) issues.push(`Changed without being asked: ${input.vision.unwantedChanges.slice(0, 4).join(", ")}.`);
    if (input.plan.sensitivity === "HIGH" && fidelity < 0.6) {
      issues.push("The subject no longer clearly resembles the reference.");
      score = Math.min(score, 0.3);
    }
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const verdict: ImageQa["verdict"] = score >= passAt ? "pass" : score >= retryBelow ? "retry" : "fail";
  return { score, verdict, change, adherence, fidelity, issues, method, checkedAt: new Date().toISOString() };
}

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

/** How many candidates to make: one, unless the job is uncertain and worth it. */
export function variationsFor(plan: ImageEditPlan, requested: number | null): number {
  if (requested) return Math.max(1, Math.min(4, requested));
  if (plan.operation === "localized_edit") return 1;
  if (plan.operation === "generate" && (plan.task === "realistic_scene" || plan.task === "typography")) return 2;
  return 1;
}
