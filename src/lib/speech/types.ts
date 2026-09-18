/**
 * The vocabulary of spoken Briefly.
 *
 * Everything a person can choose is a short closed list in plain words — a voice, a language, an
 * accent, a style, a pace — and everything the engine derives from those choices is written down in
 * a typed record. No provider's vocabulary appears here: "stability" and "voice_id" are what a
 * direction is *translated into* at the last step, not what anybody chooses.
 */

export const NARRATION_KINDS = ["EDITION", "ARTICLE", "SUMMARY", "EXECUTIVE", "VIDEO", "CUSTOM"] as const;
export type NarrationKind = (typeof NARRATION_KINDS)[number];

/** Where the words will be heard, which decides how they are performed. */
export const NARRATION_CONTEXTS = ["launch_film", "newsletter", "social", "executive", "community"] as const;
export type NarrationContext = (typeof NARRATION_CONTEXTS)[number];

export const VOICE_CHOICES = ["auto", "female", "male", "brand"] as const;
export type VoiceChoice = (typeof VOICE_CHOICES)[number];

export const ACCENTS = ["auto", "france", "belgium", "canada", "us", "british", "international"] as const;
export type Accent = (typeof ACCENTS)[number];

export const STYLES = ["cinematic", "professional", "warm", "editorial", "confident", "energetic", "minimal", "calm"] as const;
export type Style = (typeof STYLES)[number];

export const PACES = ["slow", "natural", "fast"] as const;
export type Pace = (typeof PACES)[number];

export const QUALITIES = ["PREVIEW", "FINAL"] as const;
export type Quality = (typeof QUALITIES)[number];

/** What the person asked for, in the interface's words. `voice` may also be `clone:<id>`. */
export type NarrationOptions = {
  voice: string;
  /** An ISO 639-1 code, or "auto" to follow the publication. */
  language: string;
  accent: Accent;
  style: Style;
  pace: Pace;
  takes: 1 | 2;
  /** "auto" lets an interview or a testimony be read by a second voice; "single" never does. */
  speakers: "auto" | "single";
  context?: NarrationContext;
};

export type Speaker = "narrator" | "second";

export type PassageSource = "intro" | "headline" | "body" | "quote" | "qa" | "aside" | "outro" | "scene" | "custom";

/** One stretch of speech: what is said, by whom, and where it came from. */
export type SpeechPassage = {
  index: number;
  speaker: Speaker;
  /** The text as performed — adapted for the ear, with the few audio tags it carries. */
  text: string;
  /** The same words with no tags, for the transcript and the checks. */
  plain: string;
  sourceType: PassageSource;
  /** The article, the frame, or nothing. */
  sourceId?: string | null;
  /** The chapter this passage opens or continues, for the player's table of contents. */
  chapter?: string | null;
  /** For a film: which scene this passage is spoken over, and how long that scene is held. */
  sceneIndex?: number | null;
  maxSeconds?: number | null;
};

export type SpeechScript = {
  language: string;
  title: string;
  passages: SpeechPassage[];
  words: number;
  characters: number;
  /** Whether a model adapted the words or the deterministic pass did on its own. */
  source: "model" | "local";
  adaptedAt: string;
  /** For a film: how long each scene is held before narration, and how long the joins overlap. */
  timeline?: { holds: number[]; transitionSeconds: number } | null;
};

/** The provider-facing numbers a direction resolves to. Translated per provider at the last step. */
export type VoiceSettings = {
  /** 0 = expressive and variable, 1 = steady and even. */
  stability: number;
  /** How closely the performance should stick to the voice's own timbre. */
  similarity: number;
  /** How much of the voice's native character to lean into. */
  styleExaggeration: number;
  speakerBoost: boolean;
  /** 1 is the voice's natural rate. Never far from it: a rushed narration is a rewritten one. */
  speed: number;
};

/**
 * How the words are to be performed.
 *
 * Built from the context and the style, refined by a model when one is connected, and kept with
 * the narration so a re-take of one passage is directed the same way as its neighbours.
 */
export type VoiceDirection = {
  context: NarrationContext;
  style: Style;
  pace: Pace;
  energy: "low" | "medium" | "high";
  /** One or two sentences a voice actor could work from. */
  stance: string;
  /** The audio tags this performance may use, and how sparingly. */
  tags: string[];
  /** At most this many tags per hundred words. */
  tagDensity: number;
  pauses: "few" | "natural" | "deliberate";
  settings: VoiceSettings;
  source: "model" | "local";
};
