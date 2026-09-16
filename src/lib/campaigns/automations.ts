/**
 * The automation catalogue. It lives in `lib/` rather than next to the settings service because
 * client components read it too, and importing it from the server module would pull the database
 * client into the browser bundle.
 */
export const AUTOMATION_KEYS = [
  "editionCreation",
  "contributionRequest",
  "reminder1",
  "reminder2",
  "gracePeriod",
  "aiProcessing",
  "editorialAlert",
  "coverageCheck",
  "deadlineAlert",
] as const;

export type AutomationKey = (typeof AUTOMATION_KEYS)[number];
export type AutomationToggles = Record<AutomationKey, boolean>;

export const DEFAULT_AUTOMATION_TOGGLES: AutomationToggles = {
  editionCreation: true,
  contributionRequest: true,
  reminder1: true,
  reminder2: true,
  gracePeriod: true,
  aiProcessing: true,
  editorialAlert: true,
  coverageCheck: true,
  deadlineAlert: true,
};
