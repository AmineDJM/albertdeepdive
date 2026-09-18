import { detectLanguage, type SpeechLanguage } from "./language";
import type { Pace, SpeechPassage } from "./types";
import { estimateSeconds } from "./timing";
import { MAX_HOLD_STRETCH } from "./timing";

/**
 * Voice QA.
 *
 * Nobody listens to forty minutes of narration before every send, so the checks that can be made
 * from the numbers are made from the numbers: a passage that came back silent, one that is far
 * shorter than its words need (the provider stopped early), one that reads too fast for the pace
 * asked, one whose words are in the wrong language, one with markup the model left in. Each finding
 * names a passage, because the remedy is regenerating that passage and not the whole edition.
 *
 * Pure: it looks at what was measured, never at the audio itself, so it runs anywhere.
 */

export type NarrationFinding = { code: string; severity: "defect" | "note"; message: string; passage: number | null };

export type SegmentMeasure = {
  index: number;
  status: string;
  durationSeconds: number | null;
  characters: number;
  meanVolumeDb: number | null;
  sha256: string | null;
  error?: string | null;
};

export type InspectInput = {
  language: SpeechLanguage;
  pace: Pace;
  passages: SpeechPassage[];
  segments: SegmentMeasure[];
  /** For a film: how long each scene is held, by scene index. */
  scenes?: { index: number; hold: number }[];
};

/** Below this the passage is silence with a file around it. */
const SILENT_DB = -45;
/** Characters a second: comfortable narration sits around 14–17; past this it is being rushed. */
const RUSHED_CPS = 21;
/** A passage that came out shorter than this share of its estimate did not get fully spoken. */
const TRUNCATED_RATIO = 0.45;
const DRAGGING_RATIO = 1.9;

export function inspectNarration(input: InspectInput): NarrationFinding[] {
  const findings: NarrationFinding[] = [];
  const byIndex = new Map(input.segments.map((segment) => [segment.index, segment]));
  const seenHashes = new Map<string, number>();

  for (const passage of input.passages) {
    const segment = byIndex.get(passage.index);
    const plain = passage.plain;

    if (/https?:\/\/|\*\*|<[a-z/][^>]*>|\{\{|\}\}/i.test(plain) || /\[[^\]]*$/.test(plain)) {
      findings.push({ code: "markup", severity: "defect", message: "Markup or an address is still in the words and would be read aloud.", passage: passage.index });
    }
    if (plain.length > 3000) findings.push({ code: "long-passage", severity: "note", message: "A very long passage; the voice may lose its thread. Consider splitting it.", passage: passage.index });

    if (plain.split(/\s+/).length >= 25) {
      const detected = detectLanguage(plain);
      if (detected.language && detected.language !== input.language && detected.confidence >= 0.8) {
        findings.push({ code: "language", severity: "defect", message: `These words look ${detected.language.toUpperCase()}, but the narration is in ${input.language.toUpperCase()}.`, passage: passage.index });
      }
    }

    if (!segment || segment.status !== "READY" || !segment.durationSeconds) {
      findings.push({ code: "missing-audio", severity: "defect", message: segment?.error ? `This passage was not performed: ${segment.error}` : "This passage has no audio yet.", passage: passage.index });
      continue;
    }
    if (segment.meanVolumeDb !== null && segment.meanVolumeDb < SILENT_DB) {
      findings.push({ code: "silent", severity: "defect", message: "This passage came back almost silent.", passage: passage.index });
    }
    const expected = estimateSeconds(passage.text, input.language, input.pace);
    if (expected > 2 && segment.durationSeconds < expected * TRUNCATED_RATIO) {
      findings.push({ code: "truncated", severity: "defect", message: `Far shorter than its words need (${segment.durationSeconds.toFixed(1)}s for about ${Math.round(expected)}s of text): the voice probably stopped early.`, passage: passage.index });
    } else if (segment.characters / segment.durationSeconds > RUSHED_CPS) {
      findings.push({ code: "rushed", severity: "defect", message: "Spoken too fast for the pace asked. Regenerate it, or shorten the words.", passage: passage.index });
    } else if (expected > 4 && segment.durationSeconds > expected * DRAGGING_RATIO) {
      findings.push({ code: "dragging", severity: "note", message: "Much longer than its words should take; listen for a stall.", passage: passage.index });
    }

    if (segment.sha256) {
      const earlier = seenHashes.get(segment.sha256);
      if (earlier !== undefined && input.passages[earlier]?.plain !== plain) {
        findings.push({ code: "duplicate-audio", severity: "defect", message: `Identical audio to passage ${earlier + 1}, for different words.`, passage: passage.index });
      } else seenHashes.set(segment.sha256, passage.index);
    }

    if (input.scenes && passage.sceneIndex !== null && passage.sceneIndex !== undefined) {
      const scene = input.scenes.find((entry) => entry.index === passage.sceneIndex);
      if (scene && segment.durationSeconds > scene.hold * MAX_HOLD_STRETCH) {
        findings.push({ code: "over-scene", severity: "note", message: `Runs ${segment.durationSeconds.toFixed(1)}s over a ${scene.hold.toFixed(1)}s scene; the scene is held longer. Fewer words would keep the film's rhythm.`, passage: passage.index });
      }
    }
  }
  return findings;
}

export function verdictFor(findings: NarrationFinding[]): { ok: boolean; summary: string } {
  const defects = findings.filter((finding) => finding.severity === "defect").length;
  const notes = findings.length - defects;
  if (defects) return { ok: false, summary: `${defects} passage${defects === 1 ? "" : "s"} to regenerate` };
  if (notes) return { ok: true, summary: `Sounds right · ${notes} note${notes === 1 ? "" : "s"}` };
  return { ok: true, summary: "Sounds right" };
}
