/**
 * Edition lifecycle — single source of truth for allowed transitions.
 *
 * UPCOMING → OPEN → REMINDER_1 → REMINDER_2 → GRACE_PERIOD → CLOSED → PROCESSING
 * → EDITORIAL_REVIEW → LAYOUT → FINAL_REVIEW → PUBLISHED → ARCHIVED
 */
export const EDITION_STATUSES = [
  "UPCOMING",
  "OPEN",
  "REMINDER_1",
  "REMINDER_2",
  "GRACE_PERIOD",
  "CLOSED",
  "PROCESSING",
  "EDITORIAL_REVIEW",
  "LAYOUT",
  "FINAL_REVIEW",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type EditionStatus = (typeof EDITION_STATUSES)[number];

const TRANSITIONS: Record<EditionStatus, readonly EditionStatus[]> = {
  UPCOMING: ["OPEN", "ARCHIVED"],
  OPEN: ["REMINDER_1", "REMINDER_2", "GRACE_PERIOD", "CLOSED"],
  REMINDER_1: ["REMINDER_2", "GRACE_PERIOD", "CLOSED"],
  REMINDER_2: ["GRACE_PERIOD", "CLOSED"],
  GRACE_PERIOD: ["CLOSED"],
  CLOSED: ["PROCESSING", "OPEN", "EDITORIAL_REVIEW"],
  PROCESSING: ["EDITORIAL_REVIEW", "CLOSED"],
  EDITORIAL_REVIEW: ["LAYOUT", "PROCESSING", "CLOSED"],
  LAYOUT: ["FINAL_REVIEW", "EDITORIAL_REVIEW"],
  FINAL_REVIEW: ["PUBLISHED", "LAYOUT", "EDITORIAL_REVIEW"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: EditionStatus, to: EditionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: EditionStatus): readonly EditionStatus[] {
  return TRANSITIONS[from];
}

export function assertTransition(from: EditionStatus, to: EditionStatus) {
  if (!canTransition(from, to)) {
    throw new EditionTransitionError(from, to);
  }
}

export class EditionTransitionError extends Error {
  constructor(
    public readonly from: EditionStatus,
    public readonly to: EditionStatus,
  ) {
    super(`Edition cannot move from ${from} to ${to}`);
    this.name = "EditionTransitionError";
  }
}

export const COLLECTION_STATUSES: readonly EditionStatus[] = ["OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD"];
export const PRODUCTION_STATUSES: readonly EditionStatus[] = ["CLOSED", "PROCESSING", "EDITORIAL_REVIEW", "LAYOUT", "FINAL_REVIEW"];

export function isCollecting(status: EditionStatus) {
  return COLLECTION_STATUSES.includes(status);
}

export function isEditable(status: EditionStatus) {
  return status !== "PUBLISHED" && status !== "ARCHIVED";
}

/** Human-friendly phase grouping used by the control room. */
export type EditionPhase = "COLLECT" | "ORGANISE" | "WRITE" | "EDIT" | "LAYOUT" | "QA" | "PUBLISH";

export const PHASES: { key: EditionPhase; label: string; description: string }[] = [
  { key: "COLLECT", label: "Collect", description: "Campaign, invitations, submissions" },
  { key: "ORGANISE", label: "Organise", description: "Clustering, triage, story selection" },
  { key: "WRITE", label: "Write", description: "AI drafts and editorial writing" },
  { key: "EDIT", label: "Edit", description: "Review, facts, approvals" },
  { key: "LAYOUT", label: "Layout", description: "Flatplan and page templates" },
  { key: "QA", label: "QA", description: "Quality gates and exports" },
  { key: "PUBLISH", label: "Publish", description: "Approval, publication, archive" },
];

export function phaseForStatus(status: EditionStatus): EditionPhase {
  switch (status) {
    case "UPCOMING":
    case "OPEN":
    case "REMINDER_1":
    case "REMINDER_2":
    case "GRACE_PERIOD":
      return "COLLECT";
    case "CLOSED":
    case "PROCESSING":
      return "ORGANISE";
    case "EDITORIAL_REVIEW":
      return "EDIT";
    case "LAYOUT":
      return "LAYOUT";
    case "FINAL_REVIEW":
      return "QA";
    case "PUBLISHED":
    case "ARCHIVED":
      return "PUBLISH";
  }
}

export const STATUS_LABELS: Record<EditionStatus, string> = {
  UPCOMING: "Upcoming",
  OPEN: "Open for contributions",
  REMINDER_1: "Reminder 1 sent",
  REMINDER_2: "Reminder 2 sent",
  GRACE_PERIOD: "Grace period",
  CLOSED: "Submissions closed",
  PROCESSING: "AI processing",
  EDITORIAL_REVIEW: "Editorial review",
  LAYOUT: "Layout",
  FINAL_REVIEW: "Final review",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};
