import { describe, expect, it } from "vitest";
import { inspectNarration, verdictFor, type SegmentMeasure } from "@/lib/speech/qa";
import type { SpeechPassage } from "@/lib/speech/types";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";
const passage = (index: number, text: string, extra: Partial<SpeechPassage> = {}): SpeechPassage => ({ index, speaker: "narrator", text, plain: text, sourceType: "body", ...extra });
const segment = (index: number, extra: Partial<SegmentMeasure> = {}): SegmentMeasure => ({ index, status: "READY", durationSeconds: 24, characters: 360, meanVolumeDb: -20, sha256: `hash${index}`, ...extra });

describe("voice QA", () => {
  it("passes a performance that sounds right", () => {
    const findings = inspectNarration({ language: "en", pace: "natural", passages: [passage(0, words(60))], segments: [segment(0)] });
    expect(findings).toEqual([]);
    expect(verdictFor(findings)).toEqual({ ok: true, summary: "Sounds right" });
  });

  it("names the passage that is missing, silent, cut short or rushed", () => {
    const passages = [passage(0, words(60)), passage(1, words(60)), passage(2, words(60)), passage(3, words(60))];
    const findings = inspectNarration({
      language: "en",
      pace: "natural",
      passages,
      segments: [segment(0, { status: "FAILED", durationSeconds: null, error: "boom" }), segment(1, { meanVolumeDb: -60 }), segment(2, { durationSeconds: 4 }), segment(3, { durationSeconds: 12, characters: 360 })],
    });
    expect(findings.map((finding) => [finding.code, finding.passage])).toEqual([
      ["missing-audio", 0],
      ["silent", 1],
      ["truncated", 2],
      ["rushed", 3],
    ]);
    expect(verdictFor(findings).ok).toBe(false);
    expect(verdictFor(findings).summary).toMatch(/4 passages to regenerate/);
  });

  it("catches words in the wrong language and leftover markup", () => {
    const french = "Cette année, les étudiants de la promotion ont présenté leurs projets devant un jury composé de professionnels, et les résultats sont impressionnants pour toutes les équipes engagées.";
    const findings = inspectNarration({ language: "en", pace: "natural", passages: [passage(0, french), passage(1, "See https://acme.com for more.")], segments: [segment(0, { durationSeconds: 12, characters: french.length }), segment(1, { durationSeconds: 3, characters: 30 })] });
    expect(findings.map((finding) => finding.code)).toEqual(["language", "markup"]);
  });

  it("notes a passage that runs over its scene, and identical audio for different words", () => {
    const findings = inspectNarration({
      language: "en",
      pace: "natural",
      passages: [passage(0, words(30), { sceneIndex: 0 }), passage(1, words(31), { sceneIndex: 1 })],
      segments: [segment(0, { durationSeconds: 12, characters: 180, sha256: "same" }), segment(1, { durationSeconds: 12, characters: 180, sha256: "same" })],
      scenes: [{ index: 0, hold: 3 }, { index: 1, hold: 20 }],
    });
    expect(findings.map((finding) => finding.code).sort()).toEqual(["duplicate-audio", "over-scene"]);
  });
});
