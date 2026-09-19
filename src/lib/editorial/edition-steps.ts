import type { EditionStatus } from "./edition-state";

/**
 * The five steps an edition goes through, in the words a person would use.
 *
 * The status enum underneath is a newsroom's: UPCOMING, GRACE_PERIOD, EDITORIAL_REVIEW,
 * FINAL_REVIEW. Every one of them is a real distinction and none of them is the answer to "where is
 * my newsletter up to". So this is the other vocabulary — five steps, always in the same order,
 * each one a place you can be and a thing you can do — mapped onto the statuses that already exist
 * rather than replacing them.
 *
 * Deliberately not a second state machine. Nothing here decides anything; it reads the status the
 * pipeline already set and says what that means. A sixth status added tomorrow lands in the right
 * step or fails to compile.
 */
export const EDITION_STEPS = ["CONTRIBUTORS", "TOPICS", "DRAFT", "VALIDATE", "DISTRIBUTE"] as const;
export type EditionStep = (typeof EDITION_STEPS)[number];

export type StepDefinition = {
  key: EditionStep;
  /** The step's name on the timeline. */
  label: string;
  /** What is happening while the edition sits here, for the line under the edition's name. */
  active: string;
  /** What this step is for, in one sentence, for the person who has not done it before. */
  purpose: string;
  /** The room inside an edition this step opens. */
  room: string;
};

export const STEPS: Record<EditionStep, StepDefinition> = {
  CONTRIBUTORS: {
    key: "CONTRIBUTORS",
    label: "Contributors",
    active: "Collecting contributions",
    purpose: "Choose who to ask, say what you are asking them for, and set the deadline. Briefly sends the invitations and the reminders.",
    room: "campaign",
  },
  TOPICS: {
    key: "TOPICS",
    label: "Topics",
    active: "Choosing topics",
    purpose: "What came in, grouped and deduplicated. Keep the topics you want, merge the ones that are the same story, and leave the rest.",
    room: "stories",
  },
  DRAFT: {
    key: "DRAFT",
    label: "Draft",
    active: "Writing the draft",
    purpose: "Briefly writes the edition from the topics you kept. Change it by saying what you want changed.",
    room: "revise",
  },
  VALIDATE: {
    key: "VALIDATE",
    label: "Validate",
    active: "Checking the edition",
    purpose: "Every output made from the one edition, measured before anybody sees it.",
    room: "qa",
  },
  DISTRIBUTE: {
    key: "DISTRIBUTE",
    label: "Distribute",
    active: "Published",
    purpose: "Send it, publish it, print it, download it. One edition, each way out chosen separately.",
    room: "qa",
  },
};

/** Where an edition stands, from the status the pipeline set. */
export function stepForStatus(status: EditionStatus): EditionStep {
  switch (status) {
    case "UPCOMING":
    case "OPEN":
    case "REMINDER_1":
    case "REMINDER_2":
    case "GRACE_PERIOD":
      return "CONTRIBUTORS";
    case "CLOSED":
    case "PROCESSING":
      return "TOPICS";
    case "EDITORIAL_REVIEW":
    case "LAYOUT":
      return "DRAFT";
    case "FINAL_REVIEW":
      return "VALIDATE";
    case "PUBLISHED":
    case "ARCHIVED":
      return "DISTRIBUTE";
  }
}

/**
 * The line under an edition's name: "Collecting topics", "Writing the draft", "Published".
 *
 * A couple of statuses deserve their own words because the difference matters to the person
 * waiting: an edition nobody has been invited to yet is not collecting anything, and one in its
 * grace period is collecting from people who are already late.
 */
export function standingOf(status: EditionStatus): string {
  if (status === "UPCOMING") return "Not started";
  if (status === "GRACE_PERIOD") return "Collecting — past the deadline";
  if (status === "PROCESSING") return "Sorting what came in";
  if (status === "ARCHIVED") return "Archived";
  return STEPS[stepForStatus(status)].active;
}

/** Each step with where it stands, for a timeline that shows the whole way through. */
export type StepState = StepDefinition & { state: "done" | "current" | "todo" };

export function timelineFor(status: EditionStatus): StepState[] {
  const current = stepForStatus(status);
  const at = EDITION_STEPS.indexOf(current);
  return EDITION_STEPS.map((key, index) => ({
    ...STEPS[key],
    state: index < at ? "done" : index === at ? "current" : "todo",
  }));
}
