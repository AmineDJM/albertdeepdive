/**
 * Campaign schedule helpers — pure, dependency-free, DST-safe.
 *
 * All wall-clock times are expressed in the school's timezone (Europe/Paris) and converted
 * to UTC instants with Intl, so the same code runs on the server, in tests and in the browser.
 */

export const CAMPAIGN_TIMEZONE = "Europe/Paris";

export type CampaignDefaults = {
  /** Day of the month the contribution request is sent. */
  openDay: number;
  /** Hour (0–23, local time) at which requests and reminders are sent. */
  openHour: number;
  reminder1Day: number;
  reminder2Day: number;
  /** The grace period ends at the end of this day (23:59 local). */
  graceDay: number;
  publicationDay: number;
  finalReviewDay: number;
};

export const DEFAULT_CAMPAIGN_DEFAULTS: CampaignDefaults = {
  openDay: 1,
  openHour: 9,
  reminder1Day: 4,
  reminder2Day: 7,
  graceDay: 8,
  publicationDay: 15,
  finalReviewDay: 11,
};

export const PUBLICATION_HOUR = 10;
export const FINAL_REVIEW_HOUR = 18;

export type CampaignSchedule = {
  opensAt: Date;
  reminder1At: Date;
  reminder2At: Date;
  /** End of the reminder-2 day, 23:59 local time. */
  deadlineAt: Date;
  /** End of the grace day, 23:59 local time. */
  graceEndsAt: Date;
  publicationTargetAt: Date;
  finalReviewAt: Date;
};

export type CampaignPhase = "SCHEDULED" | "OPEN" | "REMINDER_1" | "REMINDER_2" | "GRACE_PERIOD" | "CLOSED";

export type CampaignDates = {
  opensAt: Date | string;
  reminder1At: Date | string;
  reminder2At: Date | string;
  deadlineAt: Date | string;
  graceEndsAt: Date | string;
  status?: string | null;
  closedAt?: Date | string | null;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function partsInZone(date: Date, timezone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset of `timezone` from UTC (in minutes, positive east of Greenwich) at a given instant. */
export function timezoneOffsetMinutes(date: Date, timezone: string = CAMPAIGN_TIMEZONE): number {
  const p = partsInZone(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** Converts a wall-clock time expressed in `timezone` into the corresponding UTC instant. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timezone: string = CAMPAIGN_TIMEZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = timezoneOffsetMinutes(new Date(guess), timezone);
  let utc = guess - firstOffset * 60_000;
  // Re-check with the corrected instant: around a DST switch the offset can differ.
  const secondOffset = timezoneOffsetMinutes(new Date(utc), timezone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset * 60_000;
  return new Date(utc);
}

/** Calendar fields of an instant in `timezone`. */
export function zonedParts(date: Date | string, timezone: string = CAMPAIGN_TIMEZONE) {
  return partsInZone(toDate(date), timezone);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampDay(year: number, month: number, day: number) {
  return Math.min(Math.max(1, Math.round(day)), daysInMonth(year, month));
}

/**
 * Computes the full campaign schedule of an edition month from the system defaults.
 * Days beyond the length of the month are clamped to its last day.
 */
export function computeCampaignSchedule(input: {
  month: number;
  year: number;
  defaults?: Partial<CampaignDefaults>;
  timezone?: string;
}): CampaignSchedule {
  const { month, year } = input;
  const tz = input.timezone ?? CAMPAIGN_TIMEZONE;
  const d = { ...DEFAULT_CAMPAIGN_DEFAULTS, ...(input.defaults ?? {}) };
  const hour = Math.min(23, Math.max(0, Math.round(d.openHour)));
  const at = (day: number, h: number, m = 0) => zonedTimeToUtc(year, month, clampDay(year, month, day), h, m, 0, tz);
  return {
    opensAt: at(d.openDay, hour),
    reminder1At: at(d.reminder1Day, hour),
    reminder2At: at(d.reminder2Day, hour),
    deadlineAt: at(d.reminder2Day, 23, 59),
    graceEndsAt: at(d.graceDay, 23, 59),
    publicationTargetAt: at(d.publicationDay, PUBLICATION_HOUR),
    finalReviewAt: at(d.finalReviewDay, FINAL_REVIEW_HOUR),
  };
}

/** The edition month that follows the month containing `now` (in the school's timezone). */
export function nextEditionMonth(now: Date = new Date(), timezone: string = CAMPAIGN_TIMEZONE): { month: number; year: number } {
  const p = partsInZone(now, timezone);
  return p.month === 12 ? { month: 1, year: p.year + 1 } : { month: p.month + 1, year: p.year };
}

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function editionLabel(month: number, year: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * "1 Oct, 09:00" in the newsroom's timezone, in the reader's own language.
 *
 * The locale was "en-GB" and nothing else, which put "Sunday 1 November at 09:00" in the middle of
 * a French sentence — the one place in the interface where the language switch plainly did not
 * work. It stays the default so that a caller with no locale to hand behaves as it always did.
 */
export function formatZoned(date: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = {}, timezone: string = CAMPAIGN_TIMEZONE, locale: string = "en-GB") {
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(toDate(date));
}

/** "Wednesday 7 October, 23:59" — or "mercredi 7 octobre, 23:59" — in the newsroom's timezone. */
export function formatZonedLong(date: Date | string | null | undefined, timezone: string = CAMPAIGN_TIMEZONE, locale: string = "en-GB") {
  return formatZoned(date, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }, timezone, locale);
}

/** "7 Nov 2026" — or "7 nov. 2026" — in the newsroom's timezone. */
export function formatZonedDay(date: Date | string | null | undefined, locale: string = "en-GB", timezone: string = CAMPAIGN_TIMEZONE) {
  return formatZoned(date, { day: "numeric", month: "short", year: "numeric", hour: undefined, minute: undefined }, timezone, locale);
}

/** Whole calendar days from `now` to `date`, counted in the school's timezone (0 = today). */
export function calendarDaysUntil(date: Date | string, now: Date = new Date(), timezone: string = CAMPAIGN_TIMEZONE): number {
  const a = partsInZone(now, timezone);
  const b = partsInZone(toDate(date), timezone);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

export type ScheduleLine = {
  key: "CAMPAIGN_OPEN" | "REMINDER_1" | "REMINDER_2" | "DEADLINE" | "GRACE_PERIOD" | "CAMPAIGN_CLOSE";
  label: string;
  at: Date;
  /** Day of the month in the school's timezone. */
  day: number;
  line: string;
};

/** Human-readable lines for the automations screen. */
export function describeSchedule(campaign: CampaignDates, timezone: string = CAMPAIGN_TIMEZONE): ScheduleLine[] {
  const opensAt = toDate(campaign.opensAt);
  const reminder1At = toDate(campaign.reminder1At);
  const reminder2At = toDate(campaign.reminder2At);
  const deadlineAt = toDate(campaign.deadlineAt);
  const graceEndsAt = toDate(campaign.graceEndsAt);
  const day = (d: Date) => partsInZone(d, timezone).day;
  const fmt = (d: Date) => formatZoned(d, {}, timezone);
  return [
    { key: "CAMPAIGN_OPEN", label: "Contribution request", at: opensAt, day: day(opensAt), line: `Contribution request — ${fmt(opensAt)}` },
    { key: "REMINDER_1", label: "Reminder #1", at: reminder1At, day: day(reminder1At), line: `Reminder #1 — Day ${day(reminder1At)} · ${fmt(reminder1At)}` },
    { key: "REMINDER_2", label: "Reminder #2", at: reminder2At, day: day(reminder2At), line: `Reminder #2 — Day ${day(reminder2At)} · ${fmt(reminder2At)}` },
    { key: "DEADLINE", label: "Deadline", at: deadlineAt, day: day(deadlineAt), line: `Deadline — ${fmt(deadlineAt)}` },
    { key: "GRACE_PERIOD", label: "Grace period", at: deadlineAt, day: day(graceEndsAt), line: `Grace period — until ${fmt(graceEndsAt)}` },
    { key: "CAMPAIGN_CLOSE", label: "Campaign closes", at: graceEndsAt, day: day(graceEndsAt), line: `Campaign closes — ${fmt(graceEndsAt)}` },
  ];
}

/** Phase of a campaign at a given instant, derived from its dates (a closed campaign stays closed). */
export function campaignPhaseAt(campaign: CampaignDates, now: Date = new Date()): CampaignPhase {
  if (campaign.status === "CLOSED" || campaign.closedAt) return "CLOSED";
  const t = now.getTime();
  if (t < toDate(campaign.opensAt).getTime()) return "SCHEDULED";
  if (t < toDate(campaign.reminder1At).getTime()) return "OPEN";
  if (t < toDate(campaign.reminder2At).getTime()) return "REMINDER_1";
  if (t < toDate(campaign.deadlineAt).getTime()) return "REMINDER_2";
  if (t < toDate(campaign.graceEndsAt).getTime()) return "GRACE_PERIOD";
  return "CLOSED";
}

export const COLLECTING_PHASES: readonly CampaignPhase[] = ["OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD"];

export function isCollectingPhase(phase: CampaignPhase) {
  return COLLECTING_PHASES.includes(phase);
}

export const PHASE_LABELS: Record<CampaignPhase, string> = {
  SCHEDULED: "Scheduled",
  OPEN: "Open",
  REMINDER_1: "Reminder 1 sent",
  REMINDER_2: "Reminder 2 sent",
  GRACE_PERIOD: "Grace period",
  CLOSED: "Closed",
};

/** Everything one date decides, with the opening it decided them against. */
export type DeadlinePlan = {
  opensAt: Date;
  reminder1At: Date;
  reminder2At: Date;
  deadlineAt: Date;
  graceEndsAt: Date;
  /** True when the last day came before the opening, so the invitation moves to now. */
  movedOpening: boolean;
};

/**
 * What one date does to all the others.
 *
 * The reminders and the day of grace are not decisions anybody makes — they follow from the span
 * between the invitation and the last day — so they are derived, one about halfway through and one
 * near the end, with the grace day after. This is the only place that derivation exists: it ran on
 * the server at save time and the screen showed whatever had been saved *before*, so moving the
 * date moved nothing on screen until you saved and the page came back. Two copies of this rule
 * would be worse: a screen that predicts a different schedule from the one it is about to write is
 * a screen that cannot be trusted at all.
 *
 * A last day that falls before the opening is the one interesting case. On a campaign that has not
 * gone out it means "ask them now", so the opening moves to now. On one already sent, or a date
 * already past, it means nothing sensible, and this returns null rather than inventing something.
 */
export function planFromDeadline(input: { opensAt: Date | string; deadlineAt: Date | string; unsent: boolean; now?: Date }): DeadlinePlan | null {
  const now = input.now ?? new Date();
  const deadlineAt = toDate(input.deadlineAt);
  if (Number.isNaN(deadlineAt.getTime())) return null;
  let opensAt = toDate(input.opensAt);
  if (Number.isNaN(opensAt.getTime())) return null;
  let movedOpening = false;
  if (deadlineAt.getTime() <= opensAt.getTime()) {
    if (!input.unsent || deadlineAt.getTime() <= now.getTime()) return null;
    opensAt = now;
    movedOpening = true;
  }
  const span = deadlineAt.getTime() - opensAt.getTime();
  return {
    opensAt,
    reminder1At: new Date(opensAt.getTime() + Math.round(span * 0.45)),
    reminder2At: new Date(opensAt.getTime() + Math.round(span * 0.85)),
    deadlineAt,
    graceEndsAt: new Date(deadlineAt.getTime() + 86_400_000),
    movedOpening,
  };
}

export function addDays(date: Date | string, days: number): Date {
  return new Date(toDate(date).getTime() + days * 86_400_000);
}

/**
 * The calendar day an instant falls on, in the newsroom's timezone: "YYYY-MM-DD".
 *
 * What a date input holds, and what a person means by "the last day". Read in the newsroom's
 * timezone rather than the browser's, so an editor abroad and the contributor's invitation agree
 * about which day the deadline is.
 */
export function zonedDayInput(date: Date | string, timezone: string = CAMPAIGN_TIMEZONE): string {
  const p = zonedParts(toDate(date), timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DD" as the newsroom reads it → the last minute of that day, as an instant. */
export function endOfZonedDay(day: string, timezone: string = CAMPAIGN_TIMEZONE): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [, y, m, d] = match;
  return zonedTimeToUtc(Number(y), Number(m), Number(d), 23, 59, 0, timezone);
}
