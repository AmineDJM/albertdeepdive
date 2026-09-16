/**
 * Read model for the edition's Campaign tab.
 *
 * Nothing here writes: it assembles what the campaign services already expose (schedule,
 * statistics, coverage, requests, automation runs) plus the personal contribution links, which
 * are derived from the request id and its expiry — never stored — exactly as the mailer does.
 */
import { and, count, eq, ne } from "drizzle-orm";
import { db } from "@/server/db/client";
import { submissions } from "@/server/db/schema";
import { listCampusesWithStats, listGroups } from "@/server/contributors/service";
import { getEdition } from "@/server/editions/service";
import { listEmails, type MailboxRow } from "@/server/settings/mailbox";
import {
  campaignPhaseAt,
  describeSchedule,
  formatZoned,
  type CampaignDefaults,
  type CampaignPhase,
  type ScheduleLine,
} from "@/lib/campaigns/schedule";
import { coverageByCampus, type EditionCoverage } from "./coverage";
import { automationRunsByStep } from "./scheduler";
import { getCampaignDefaults } from "./settings";
import { contributionLink, mintRequestToken } from "./tokens";
import {
  campaignStats,
  getCampaignForEdition,
  listCampaignRequests,
  previewSelection,
  type Campaign,
  type CampaignStats,
  type SelectionPreview,
} from "./service";

export type InvitationRow = {
  requestId: string;
  contributorId: string;
  name: string;
  email: string;
  type: string;
  campusId: string | null;
  campusName: string | null;
  status: "PENDING" | "SENT" | "OPENED" | "SUBMITTED" | "DECLINED" | "EXPIRED" | "BOUNCED";
  sentAt: Date | null;
  openedAt: Date | null;
  submittedAt: Date | null;
  remindedCount: number;
  lastRemindedAt: Date | null;
  submissionsCount: number;
  tokenExpiresAt: Date;
  tokenExpired: boolean;
  /** Personal contribution URL — derived, never stored. */
  link: string;
};

/** One line per campus (plus the school-wide bucket) of the coverage table. */
export type CampaignCampusRow = {
  key: string;
  campusId: string | null;
  name: string;
  colour: string | null;
  target: number;
  pool: number;
  invited: number;
  submitted: number;
  declined: number;
  silent: number;
  submissions: number;
  responseRate: number;
};

export type AutomationRunRow = {
  step: string;
  status: string;
  triggeredBy: string;
  scheduledFor: Date | null;
  finishedAt: Date | null;
  error: string | null;
  summary: Record<string, unknown>;
};

export type CampaignScreen = {
  edition: Awaited<ReturnType<typeof getEdition>>;
  campaign: Campaign | null;
  phase: CampaignPhase;
  schedule: ScheduleLine[];
  stats: CampaignStats | null;
  selection: SelectionPreview | null;
  byCampus: CampaignCampusRow[];
  invitations: InvitationRow[];
  coverage: EditionCoverage;
  campuses: Awaited<ReturnType<typeof listCampusesWithStats>>;
  groups: Awaited<ReturnType<typeof listGroups>>;
  runs: AutomationRunRow[];
  emails: MailboxRow[];
  defaults: CampaignDefaults;
  /** Submissions attached to the edition, whatever their campaign. */
  submissionsTotal: number;
  /** Next scheduled step, in words, for the header. */
  nextStep: { label: string; at: Date; whenLabel: string } | null;
};

const SCHOOL_KEY = "school";

function nextScheduleStep(schedule: ScheduleLine[], now: Date) {
  const upcoming = schedule.filter((line) => line.at.getTime() > now.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  return upcoming ? { label: upcoming.label, at: upcoming.at, whenLabel: formatZoned(upcoming.at, { weekday: "short" }) } : null;
}

/** Everything the Campaign tab renders, in one round trip. */
export async function campaignScreen(editionId: string, now = new Date()): Promise<CampaignScreen> {
  const [edition, campaign, campuses, groups, coverage, defaults, runsByStep, emails, submissionCount] = await Promise.all([
    getEdition(editionId),
    getCampaignForEdition(editionId),
    listCampusesWithStats(),
    listGroups(),
    coverageByCampus(editionId),
    getCampaignDefaults(),
    automationRunsByStep(editionId),
    listEmails({ editionId }, 60),
    db
      .select({ n: count() })
      .from(submissions)
      .where(and(eq(submissions.editionId, editionId), ne(submissions.status, "DRAFT"))),
  ]);

  const runs: AutomationRunRow[] = [...runsByStep.values()]
    .map((r) => ({
      step: r.step,
      status: r.status,
      triggeredBy: r.triggeredBy,
      scheduledFor: r.scheduledFor,
      finishedAt: r.finishedAt,
      error: r.error,
      summary: (r.summary ?? {}) as Record<string, unknown>,
    }))
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0));

  if (!campaign) {
    return {
      edition,
      campaign: null,
      phase: "SCHEDULED",
      schedule: [],
      stats: null,
      selection: null,
      byCampus: [],
      invitations: [],
      coverage,
      campuses,
      groups,
      runs,
      emails,
      defaults,
      submissionsTotal: Number(submissionCount[0]?.n ?? 0),
      nextStep: null,
    };
  }

  const [stats, selection, requestRows] = await Promise.all([
    campaignStats(campaign.id, now),
    previewSelection(campaign.id).catch(() => null),
    listCampaignRequests(campaign.id),
  ]);

  const invitations: InvitationRow[] = requestRows.map(({ request, contributor, campusName }) => ({
    requestId: request.id,
    contributorId: contributor.id,
    name: `${contributor.firstName} ${contributor.lastName}`.trim(),
    email: contributor.email,
    type: contributor.type,
    campusId: request.campusId,
    campusName,
    status: request.status,
    sentAt: request.sentAt,
    openedAt: request.openedAt,
    submittedAt: request.submittedAt,
    remindedCount: request.remindedCount,
    lastRemindedAt: request.lastRemindedAt,
    submissionsCount: request.submissionsCount,
    tokenExpiresAt: request.tokenExpiresAt,
    tokenExpired: request.tokenExpiresAt.getTime() <= now.getTime(),
    link: contributionLink(mintRequestToken(request.id, request.tokenExpiresAt)),
  }));

  const targets = campaign.targets ?? {};
  const poolByKey = new Map((selection?.byCampus ?? []).map((c) => [c.key, c.pool]));
  const statsByCampus = new Map(stats.byCampus.map((c) => [c.campusId ?? SCHOOL_KEY, c]));
  const colourByCampus = new Map(campuses.map((c) => [c.id, c.colour]));

  const keys = [...campuses.filter((c) => c.isActive).map((c) => c.id), SCHOOL_KEY];
  for (const key of Object.keys(targets)) if (!keys.includes(key)) keys.push(key);

  const byCampus: CampaignCampusRow[] = keys.map((key) => {
    const campus = key === SCHOOL_KEY ? null : campuses.find((c) => c.id === key);
    const line = statsByCampus.get(key);
    const invited = invitations.filter((i) => (i.campusId ?? SCHOOL_KEY) === key);
    const submitted = invited.filter((i) => i.status === "SUBMITTED").length;
    const declined = invited.filter((i) => i.status === "DECLINED").length;
    return {
      key,
      campusId: key === SCHOOL_KEY ? null : key,
      name: key === SCHOOL_KEY ? "Whole school" : (campus?.name ?? "Unknown campus"),
      colour: key === SCHOOL_KEY ? null : (colourByCampus.get(key) ?? null),
      target: targets[key] ?? 0,
      pool: poolByKey.get(key) ?? 0,
      invited: invited.length,
      submitted,
      declined,
      silent: invited.length - submitted - declined,
      submissions: line?.submissions ?? 0,
      responseRate: invited.length ? Math.round((submitted / invited.length) * 1000) / 1000 : 0,
    };
  });

  const schedule = describeSchedule(campaign);

  return {
    edition,
    campaign,
    phase: campaignPhaseAt(campaign, now),
    schedule,
    stats,
    selection,
    byCampus,
    invitations,
    coverage,
    campuses,
    groups,
    runs,
    emails,
    defaults,
    submissionsTotal: Number(submissionCount[0]?.n ?? 0),
    nextStep: campaign.status === "CLOSED" ? null : nextScheduleStep(schedule, now),
  };
}
