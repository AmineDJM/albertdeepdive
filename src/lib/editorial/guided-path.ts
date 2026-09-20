import { EDITION_STEPS, stepForStatus, type EditionStep } from "./edition-steps";
import type { EditionStatus } from "./edition-state";

/**
 * One button at the bottom of every screen, and where it goes.
 *
 * The five steps on the timeline answer "where is this edition up to". They do not answer the
 * question somebody making their first newsletter actually has, which is "what do I do now" — and
 * a panel of eight rows each offering "Change" is a worse answer than none: it tells you
 * everything you *could* do and nothing about what to do first.
 *
 * So Standard also has a path: an order through the screens, with one primary action on each that
 * goes to the next. Nobody has to choose where to go; they press the button.
 *
 * The path and the timeline are the same object seen at two scales, and this file is the only
 * place either is defined — because the last time two pieces of navigation were defined separately
 * they disagreed in public, with one word going to two places and two words to one. Every screen
 * here names the timeline step it belongs to, and a test walks the path to prove those steps never
 * run backwards: the map cannot say you moved from Draft to Topics while the path says forward.
 */
export type GuidedScreen = {
  key: string;
  /** The room inside the edition, as the URL segment. Empty string is the edition's own page. */
  room: string;
  /** Which of the five timeline steps this screen sits in. */
  step: EditionStep;
  /** The question this screen asks, in the words it asks it. */
  question: string;
  /** What the button at the bottom says. The last screen has none: there is nowhere further. */
  cta: string | null;
};

/**
 * Setting an edition up is four screens, and all four are the first step of the timeline.
 *
 * Pictures belongs here rather than beside the draft because it is part of preparing an edition —
 * a cover, the brand's own photographs — and putting it after Topics would make the timeline run
 * backwards halfway through the path. What the path may not do is contradict the map.
 */
export const GUIDED_PATH: readonly GuidedScreen[] = [
  { key: "setup", room: "", step: "CONTRIBUTORS", question: "What Briefly decided", cta: "Validate" },
  { key: "ask", room: "ask", step: "CONTRIBUTORS", question: "What are you asking for?", cta: "Next" },
  { key: "who", room: "campaign", step: "CONTRIBUTORS", question: "Who are you asking?", cta: "Next" },
  { key: "pictures", room: "media", step: "CONTRIBUTORS", question: "Pictures", cta: "Next" },
  { key: "topics", room: "topics", step: "TOPICS", question: "Which topics are going in?", cta: "Next" },
  { key: "draft", room: "revise", step: "DRAFT", question: "The draft", cta: "Next" },
  { key: "check", room: "qa", step: "VALIDATE", question: "Everything checked", cta: "Next" },
  { key: "send", room: "exports", step: "DISTRIBUTE", question: "Out into the world", cta: null },
];

/** The screen a room is, when it is one. Rooms off the path have no button and that is correct. */
export function screenFor(room: string): GuidedScreen | null {
  return GUIDED_PATH.find((screen) => screen.room === room) ?? null;
}

/** Where the button at the bottom of a room goes, and what it says. */
export function nextFrom(editionId: string, room: string): { href: string; label: string } | null {
  const at = GUIDED_PATH.findIndex((screen) => screen.room === room);
  if (at < 0) return null;
  const here = GUIDED_PATH[at];
  const next = GUIDED_PATH[at + 1];
  if (!here.cta || !next) return null;
  return { href: `/editions/${editionId}${next.room ? `/${next.room}` : ""}`, label: here.cta };
}

/**
 * Where to resume, from the status the pipeline set.
 *
 * Home opens an edition at the first screen of the step it is actually on, rather than always at
 * the beginning — somebody coming back to an edition that is already collecting should not be
 * shown the setup again as though nothing had happened.
 */
export function resumeAt(editionId: string, status: EditionStatus): string {
  // The timeline already owns status → step. Re-deriving it here would be exactly the second
  // opinion this file exists to prevent.
  const step = stepForStatus(status);
  const screen = GUIDED_PATH.find((each) => each.step === step) ?? GUIDED_PATH[0];
  return `/editions/${editionId}${screen.room ? `/${screen.room}` : ""}`;
}

/** The order the timeline runs in, for the test that proves the path never goes backwards. */
export const STEP_ORDER = new Map(EDITION_STEPS.map((step, index) => [step, index]));
