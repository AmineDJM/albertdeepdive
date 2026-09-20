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
 * Setting an edition up is five screens, and all five are the first step of the timeline.
 *
 * Pictures belongs here rather than beside the draft because it is part of preparing an edition —
 * a cover, the brand's own photographs — and putting it after Topics would make the timeline run
 * backwards halfway through the path. What the path may not do is contradict the map.
 */
export const GUIDED_PATH: readonly GuidedScreen[] = [
  { key: "setup", room: "", step: "CONTRIBUTORS", question: "What Briefly decided", cta: "Validate" },
  { key: "ask", room: "ask", step: "CONTRIBUTORS", question: "What are you asking for?", cta: "Next" },
  { key: "who", room: "campaign", step: "CONTRIBUTORS", question: "Who are you asking?", cta: "Next" },
  { key: "when", room: "deadline", step: "CONTRIBUTORS", question: "When for?", cta: "Next" },
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

/**
 * The path stops where the edition does.
 *
 * Setting an edition up is the first four screens — what you are asking for, who you are asking,
 * and by when — and the fifth onwards is about what came back. Nothing comes back until the
 * invitation has gone, so a path that walked straight on to the pictures and the topics was
 * walking through empty rooms and calling it progress: an editor could reach "Which topics are
 * going in?" on an edition nobody had been invited to, read "0 topics", and have no way of knowing
 * that the reason was a button they never pressed two screens back.
 *
 * So while the invitation is unsent, the fourth screen is the last one, and the thing to do there
 * is send it. Afterwards the whole path opens and nothing has moved.
 */
export const LAST_SETUP_ROOM = "deadline";

export type PathState = {
  /** Whether the contribution request has actually gone out. */
  invitationSent?: boolean;
};

export function nextFrom(editionId: string, room: string, state: PathState = {}): { href: string; label: string } | null {
  const at = GUIDED_PATH.findIndex((screen) => screen.room === room);
  if (at < 0) return null;
  const here = GUIDED_PATH[at];
  const next = GUIDED_PATH[at + 1];
  if (!here.cta || !next) return null;
  if (room === LAST_SETUP_ROOM && state.invitationSent === false) return null;
  return { href: `/editions/${editionId}${next.room ? `/${next.room}` : ""}`, label: here.cta };
}

/** The screen before this one, for the way back. The first screen has none. */
export function previousFrom(editionId: string, room: string): { href: string } | null {
  const at = GUIDED_PATH.findIndex((screen) => screen.room === room);
  if (at <= 0) return null;
  const before = GUIDED_PATH[at - 1];
  return { href: `/editions/${editionId}${before.room ? `/${before.room}` : ""}` };
}

/** How far along the path a room is, or -1 for a room that is not on it. */
export function positionOf(room: string | null | undefined): number {
  return room === null || room === undefined ? -1 : GUIDED_PATH.findIndex((screen) => screen.room === room);
}

/**
 * Where to resume: the further of what the pipeline did and what the people did.
 *
 * The status says where the edition has got to on its own — collecting, being written, out. The
 * remembered room says where somebody actually walked to, which the status cannot know: an issue
 * can sit collecting for a fortnight while an editor has already been through the pictures. Taking
 * whichever is further is the only rule that never sends a person back over work they finished,
 * and never skips a step the edition has not reached.
 */
export function resumeAt(editionId: string, status: EditionStatus, reached?: string | null, state: PathState = {}): string {
  // The timeline already owns status → step. Re-deriving it here would be exactly the second
  // opinion this file exists to prevent.
  const step = stepForStatus(status);
  const byStatus = GUIDED_PATH.find((each) => each.step === step) ?? GUIDED_PATH[0];
  let screen = positionOf(reached) > positionOf(byStatus.room) ? GUIDED_PATH[positionOf(reached)] : byStatus;
  // And never past the setup while the invitation is still sitting there unsent, whatever anybody
  // reached by typing a URL: coming back to an edition should land on the thing left to do.
  const stopAt = positionOf(LAST_SETUP_ROOM);
  if (state.invitationSent === false && positionOf(screen.room) > stopAt) screen = GUIDED_PATH[stopAt];
  return `/editions/${editionId}${screen.room ? `/${screen.room}` : ""}`;
}

/** The order the timeline runs in, for the test that proves the path never goes backwards. */
export const STEP_ORDER = new Map(EDITION_STEPS.map((step, index) => [step, index]));
