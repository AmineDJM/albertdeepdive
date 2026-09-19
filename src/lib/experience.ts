/**
 * The two ways to use Briefly.
 *
 * Standard is the product: what Briefly collected, what you chose, a preview, publish. It shows
 * the few decisions that change the result — language, audience, date, outputs, stories,
 * pictures, tone, sender — as one line each with a "Change", and keeps everything else on smart
 * defaults. Advanced is the same product with every door open: flatplans, exports, prompts,
 * automations, the records.
 *
 * The mode belongs to the person, not the workspace, and it hides nothing for good: a screen that
 * is not on the Standard sidebar still opens from a link, from ⌘K, or by switching. Nothing is
 * changed by switching — not the brand, not an edition, not a setting. Only what is shown.
 */
export const EXPERIENCE_MODES = ["standard", "advanced"] as const;
export type ExperienceMode = (typeof EXPERIENCE_MODES)[number];

export const DEFAULT_EXPERIENCE: ExperienceMode = "standard";

/** The mode a person chose, or Standard until they choose. */
export function experienceOf(preferences: Record<string, unknown> | null | undefined): ExperienceMode {
  const value = preferences?.experience;
  return value === "advanced" ? "advanced" : DEFAULT_EXPERIENCE;
}

export function isExperienceMode(value: unknown): value is ExperienceMode {
  return typeof value === "string" && (EXPERIENCE_MODES as readonly string[]).includes(value);
}

/**
 * The workspace pages Standard puts on the sidebar and in the tab rows, by path.
 *
 * Everything else still exists and still opens; it is simply not on the way. The list is by path
 * rather than by feature so a page added later is hidden until someone decides it belongs here.
 */
export const STANDARD_PATHS = new Set<string>([
  "/overview",
  "/publications",
  // The list is no longer a destination in the sidebar, but an edition's own workspace is where
  // most of the work happens and it is opened from Home. It is on Standard's way, and a path that
  // is not counts as somewhere Standard does not go.
  "/editions",
  "/archive",
  "/library",
  "/subscribers",
  "/contributors",
  "/analytics",
  "/settings",
]);

/** The settings pages Standard lists. The rest open from Advanced, or from a link. */
export const STANDARD_SETTINGS = new Set<string>(["/settings/profile", "/settings/workspace", "/settings/brand", "/settings/email", "/settings/billing", "/settings/users", "/settings/help"]);

/**
 * The rooms of an edition Standard shows: where you stand, the stories and the people who sent
 * them, the pictures, and the door out. The flatplan, the exports, the audio and the edition's own
 * settings wait in Advanced.
 */
// "revise" is in Standard on purpose: saying "make it shorter" is the simplest way there is to
// change an issue, and the one that needs no vocabulary at all.
export const STANDARD_ROOMS = new Set<string>(["", "topics", "stories", "articles", "inbox", "campaign", "revise", "media", "qa"]);

/** Whether a path is on Standard's way, by its first segment. */
export function onStandardPath(href: string): boolean {
  const root = `/${href.split("/").filter(Boolean)[0] ?? ""}`;
  return STANDARD_PATHS.has(root);
}
