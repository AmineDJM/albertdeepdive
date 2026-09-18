import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateSeconds } from "@/lib/speech/timing";
import { runFfmpeg } from "@/server/speech/mastering";
import type { CloneInput, ProviderVoice, SpeechProvider, SynthesisRequest, SynthesisResult } from "@/server/speech/providers/types";

/**
 * A provider that never reaches the network and still produces real audio.
 *
 * Each passage becomes a tone as long as its words would take to say, so the mastering, the
 * measuring and the checks run against genuine files rather than stubs — the whole pipeline
 * after the provider is exercised for real.
 */
export class FakeSpeechProvider implements SpeechProvider {
  readonly name = "fake" as const;
  requests: SynthesisRequest[] = [];
  clones: CloneInput[] = [];
  deleted: string[] = [];
  /** Make a passage come out wrong on purpose: index → what goes wrong. */
  sabotage = new Map<number, "silent" | "short">();
  private counter = 0;

  async available() {
    return true;
  }
  modelFor(quality: "PREVIEW" | "FINAL") {
    return quality === "FINAL" ? "fake-final" : "fake-preview";
  }

  async synthesize(request: SynthesisRequest): Promise<SynthesisResult> {
    this.requests.push(request);
    this.counter += 1;
    const index = this.requests.length - 1;
    const wanted = estimateSeconds(request.text, request.language, "natural");
    // Only the first performance of a text can be sabotaged: the redo must come out right.
    const firstTime = this.requests.filter((earlier) => earlier.text === request.text).length === 1;
    const trouble = firstTime ? (this.sabotage.get(index) ?? null) : null;
    const seconds = trouble === "short" ? 0.3 : Math.max(0.5, wanted);
    const volume = trouble === "silent" ? 0.0001 : 0.3;
    const directory = await mkdtemp(join(tmpdir(), "fake-speech-"));
    const output = join(directory, "tone.mp3");
    // A different pitch every time, so two passages of the same length never come out as the same file.
    const pitch = 200 + ((this.counter * 37) % 600) + ((request.seed ?? 0) % 40);
    const { code, stderr } = await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${pitch}:duration=${seconds.toFixed(2)}`, "-af", `volume=${volume}`, "-ar", "22050", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k", output]);
    if (code !== 0) throw new Error(`fake speech could not make a tone: ${stderr.slice(0, 200)}`);
    const bytes = await readFile(output);
    await rm(directory, { recursive: true, force: true });
    return { bytes, mimeType: "audio/mpeg", characters: request.text.length, provider: "fake", model: this.modelFor(request.quality), requestId: `fake-${this.counter}`, costCents: Math.round((request.text.length / 1000) * 30 * 10000) / 10000 };
  }

  async listVoices(): Promise<ProviderVoice[]> {
    return [];
  }

  async cloneVoice(input: CloneInput) {
    this.clones.push(input);
    return { voiceId: `fake-clone-${this.clones.length}` };
  }

  async deleteVoice(voiceId: string) {
    this.deleted.push(voiceId);
  }
}
