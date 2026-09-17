/**
 * Campaign service — the monthly contribution campaign of an edition: scheduling, contributor
 * selection, invitations, reminders, closing, statistics. Every automated step is idempotent
 * through `automation_runs` (see ./runs.ts).
 */
import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import {
  campuses,
  contributorGroupMembers,
  contributors,
  editions,
  submissionCampaigns,
  submissionCampuses,
  submissionRequests,
  submissions,
} from "@/server/db/schema";
import type { CampaignTargets } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { sendEmail } from "@/server/email";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { createLogger } from "@/server/logger";
import { AppError, NotFoundError, ValidationError } from "@/lib/action-result";
import { assertTransition, canTransition, type EditionStatus } from "@/lib/editorial/edition-state";
import { selectContributors, targetKeyFor, type SelectableContributor } from "@/lib/campaigns/selection";
import { addDays, campaignPhaseAt, computeCampaignSchedule, type CampaignPhase } from "@/lib/campaigns/schedule";
import { closedEmail, invitationEmail, reminderEmail, type ReminderKind } from "./emails";
import { notifyEditors } from "./notify";
import { releaseRun, runStep, type TriggeredBy } from "./runs";
import { getCampaignDefaults, getContactSettings } from "./settings";
import { contributionLink, defaultTokenExpiry, mintRequestToken, requestTokenHash, rotatedTokenExpiry } from "./tokens";

const log = createLogger("campaigns");

export type Campaign = typeof submissionCampaigns.$inferSelect;
export type Edition = typeof editions.$inferSelect;
export type SubmissionRequest = typeof submissionRequests.$inferSelect;
export type CampaignStatus = Campaign["status"];

/** Whoever triggers an action: a signed-in user (server action) or nobody (scheduler). */
export type Actor = { id: string } | null | undefined;

export type StepOptions = {
  userId?: string | null;
  triggeredBy: TriggeredBy;
  /** Injected clock — the scheduler and tests pass a fake `now`. */
  now?: Date;
};

export const ACTIVE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ["OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD"];
export const REMINDABLE_REQUEST_STATUSES: readonly SubmissionRequest["status"][] = ["SENT", "OPENED"];

// ── Loading ────────────────────────────────────────────────────────────────

export async function getCampaignForEdition(editionId: string): Promise<Campaign | null> {
  const row = await db.query.submissionCampaigns.findFirst({ where: eq(submissionCampaigns.editionId, editionId), orderBy: [desc(submissionCampaigns.createdAt)] });
  return row ?? null;
}

export async function getCampaign(campaignId: string): Promise<Campaign> {
  const row = await db.query.submissionCampaigns.findFirst({ where: eq(submissionCampaigns.id, campaignId) });
  if (!row) throw new NotFoundError("Campaign");
  return row;
}

async function loadCampaignWithEdition(campaignId: string): Promise<{ campaign: Campaign; edition: Edition }> {
  const campaign = await getCampaign(campaignId);
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, campaign.editionId) });
  if (!edition) throw new NotFoundError("Edition");
  return { campaign, edition };
}

// ── Create / update ────────────────────────────────────────────────────────

const dateInput = z.coerce.date({ error: "Enter a valid date" });

export const campaignInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    opensAt: dateInput,
    reminder1At: dateInput,
    reminder2At: dateInput,
    deadlineAt: dateInput,
    graceEndsAt: dateInput,
    targets: z.record(z.string().min(1), z.coerce.number().int().min(0).max(1000)).default({}),
    contributorGroupIds: z.array(z.uuid()).default([]),
    introMessage: z.string().trim().max(2000).nullable().optional(),
    autoProcess: z.boolean().default(true),
    reinvitePrevious: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const order: [keyof typeof v, keyof typeof v, string][] = [
      ["opensAt", "reminder1At", "Reminder 1 must come after the opening"],
      ["reminder1At", "reminder2At", "Reminder 2 must come after reminder 1"],
      ["reminder2At", "deadlineAt", "The deadline must come after reminder 2"],
      ["deadlineAt", "graceEndsAt", "The grace period must end after the deadline"],
    ];
    for (const [a, b, message] of order) {
      const da = v[a] as Date;
      const dbb = v[b] as Date;
      if (!(dbb.getTime() > da.getTime())) ctx.addIssue({ code: "custom", path: [b], message });
    }
  });

export type CampaignInput = z.input<typeof campaignInputSchema>;

function validationError(err: z.ZodError): ValidationError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of err.issues) (fieldErrors[issue.path.map(String).join(".") || "_form"] ??= []).push(issue.message);
  return new ValidationError("Please check the campaign settings", fieldErrors);
}

/** Creates the edition's campaign or updates the existing one (validated dates → SCHEDULED). */
export async function createOrUpdateCampaign(editionId: string, input: CampaignInput, user: Actor): Promise<Campaign> {
  const parsed = campaignInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error);
  const data = parsed.data;
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const existing = await getCampaignForEdition(editionId);

  if (existing && existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
    if (existing.opensAt.getTime() !== data.opensAt.getTime()) {
      throw new ValidationError("The campaign is already open: the opening date cannot change", { opensAt: ["The campaign is already open"] });
    }
    if (existing.status === "CLOSED") throw new AppError("The campaign is closed. Reopen it to change its dates.", "CAMPAIGN_CLOSED", 409);
  }

  const values = {
    name: data.name ?? existing?.name ?? `${edition.label} contributions`,
    opensAt: data.opensAt,
    reminder1At: data.reminder1At,
    reminder2At: data.reminder2At,
    deadlineAt: data.deadlineAt,
    graceEndsAt: data.graceEndsAt,
    targets: data.targets,
    contributorGroupIds: data.contributorGroupIds,
    introMessage: data.introMessage ?? null,
    autoProcess: data.autoProcess,
    reinvitePrevious: data.reinvitePrevious,
  };

  let campaign: Campaign;
  if (existing) {
    const status: CampaignStatus = existing.status === "DRAFT" ? "SCHEDULED" : existing.status;
    [campaign] = await db.update(submissionCampaigns).set({ ...values, status }).where(eq(submissionCampaigns.id, existing.id)).returning();
    if (ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status)) await extendRequestTokens(campaign);
  } else {
    [campaign] = await db
      .insert(submissionCampaigns)
      .values({ ...values, editionId, status: "SCHEDULED", createdById: user?.id ?? null })
      .returning();
  }
  await audit({
    action: existing ? "campaign.update" : "campaign.create",
    userId: user?.id,
    entityType: "CAMPAIGN",
    entityId: campaign.id,
    editionId,
    metadata: { status: campaign.status, opensAt: campaign.opensAt.toISOString(), graceEndsAt: campaign.graceEndsAt.toISOString(), targets: campaign.targets },
  });
  return campaign;
}

/** Builds (or rebuilds) the campaign of an edition from the system defaults and the previous campaign. */
export async function scheduleFromDefaults(editionId: string, user: Actor): Promise<Campaign> {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const defaults = await getCampaignDefaults();
  const schedule = computeCampaignSchedule({ month: edition.month, year: edition.year, defaults });
  const existing = await getCampaignForEdition(editionId);
  const previous = existing
    ? null
    : await db.query.submissionCampaigns.findFirst({
        where: ne(submissionCampaigns.editionId, editionId),
        orderBy: [desc(submissionCampaigns.opensAt)],
      });
  let targets: CampaignTargets = existing?.targets ?? previous?.targets ?? {};
  let groupIds = existing?.contributorGroupIds ?? previous?.contributorGroupIds ?? [];
  if (!Object.keys(targets).length) {
    // The per-campus default an editor configured on the Campuses screen is the starting number.
    const active = await db.select({ id: campuses.id, defaultInviteTarget: campuses.defaultInviteTarget }).from(campuses).where(eq(campuses.isActive, true));
    targets = Object.fromEntries([...active.map((c) => [c.id, c.defaultInviteTarget] as const), ["school", 0] as const]);
  }
  if (!groupIds.length) {
    const groups = await db.query.contributorGroups.findMany();
    groupIds = groups.filter((g) => g.slug !== "partners").map((g) => g.id);
  }
  const campaign = await createOrUpdateCampaign(
    editionId,
    {
      name: existing?.name ?? `${edition.label} contributions`,
      opensAt: schedule.opensAt,
      reminder1At: schedule.reminder1At,
      reminder2At: schedule.reminder2At,
      deadlineAt: schedule.deadlineAt,
      graceEndsAt: schedule.graceEndsAt,
      targets,
      contributorGroupIds: groupIds,
      introMessage: existing?.introMessage ?? previous?.introMessage ?? "Tell us what happened around you this month: Business Deep Dives, events, associations, achievements and photos.",
      autoProcess: existing?.autoProcess ?? true,
      reinvitePrevious: existing?.reinvitePrevious ?? previous?.reinvitePrevious ?? false,
    },
    user,
  );
  if (!edition.publicationTargetAt || !edition.finalReviewAt) {
    await db
      .update(editions)
      .set({ publicationTargetAt: edition.publicationTargetAt ?? schedule.publicationTargetAt, finalReviewAt: edition.finalReviewAt ?? schedule.finalReviewAt })
      .where(eq(editions.id, editionId));
  }
  return campaign;
}

// ── Selection ──────────────────────────────────────────────────────────────

export type EligibleContributor = SelectableContributor & {
  firstName: string;
  lastName: string;
  email: string;
  campusName: string | null;
  type: (typeof contributors.$inferSelect)["type"];
};

/** Active contributors that belong to at least one of the groups, with their group ids. */
export async function loadEligibleContributors(groupIds: readonly string[]): Promise<EligibleContributor[]> {
  if (!groupIds.length) return [];
  const rows = await db
    .select({
      id: contributors.id,
      firstName: contributors.firstName,
      lastName: contributors.lastName,
      email: contributors.email,
      campusId: contributors.campusId,
      campusName: campuses.name,
      type: contributors.type,
      isActive: contributors.isActive,
      responseRate: contributors.responseRate,
      lastInvitedAt: contributors.lastInvitedAt,
      submissionsCount: contributors.submissionsCount,
      groupId: contributorGroupMembers.groupId,
    })
    .from(contributorGroupMembers)
    .innerJoin(contributors, eq(contributors.id, contributorGroupMembers.contributorId))
    .leftJoin(campuses, eq(campuses.id, contributors.campusId))
    .where(inArray(contributorGroupMembers.groupId, [...groupIds]));
  const byId = new Map<string, EligibleContributor>();
  for (const r of rows) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.groupIds = [...existing.groupIds, r.groupId];
      continue;
    }
    byId.set(r.id, { ...r, groupIds: [r.groupId] });
  }
  return [...byId.values()];
}

/**
 * The contributors invited to the edition immediately before this campaign's edition. Held back by
 * default so each month rotates through the pool instead of asking the same people again.
 */
export async function previousEditionContributorIds(editionId: string): Promise<Set<string>> {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId), columns: { id: true, issueNumber: true } });
  if (!edition) return new Set();
  const prev = await db.query.editions.findFirst({
    where: and(ne(editions.id, editionId), sql`${editions.issueNumber} < ${edition.issueNumber}`),
    orderBy: [desc(editions.issueNumber)],
    columns: { id: true },
  });
  if (!prev) return new Set();
  const rows = await db
    .select({ contributorId: submissionRequests.contributorId })
    .from(submissionRequests)
    .where(eq(submissionRequests.editionId, prev.id));
  return new Set(rows.map((r) => r.contributorId));
}

/** Turns a campaign's reinvite flag into the selection's exclusion inputs. */
async function exclusionFor(campaign: Campaign): Promise<{ excludeIds: Set<string>; strictExclude: boolean }> {
  if (campaign.reinvitePrevious) return { excludeIds: new Set(), strictExclude: false };
  return { excludeIds: await previousEditionContributorIds(campaign.editionId), strictExclude: true };
}

export type SelectionPreview = {
  selected: (EligibleContributor & { alreadyInvited: boolean })[];
  byCampus: { key: string; campusId: string | null; name: string; target: number; selected: number; pool: number; shortfall: number }[];
  totals: { target: number; selected: number; shortfall: number; pool: number; alreadyInvited: number };
};

/** Who would be invited if the campaign opened now. */
export async function previewSelection(campaignId: string): Promise<SelectionPreview> {
  const campaign = await getCampaign(campaignId);
  const pool = await loadEligibleContributors(campaign.contributorGroupIds);
  const targets = campaign.targets ?? {};
  const { excludeIds, strictExclude } = await exclusionFor(campaign);
  const selection = selectContributors({ contributors: pool, groupIds: campaign.contributorGroupIds, targets, seed: campaign.id, excludeIds, strictExclude });
  const existing = await db.select({ contributorId: submissionRequests.contributorId }).from(submissionRequests).where(eq(submissionRequests.campaignId, campaignId));
  const invited = new Set(existing.map((r) => r.contributorId));
  const poolById = new Map(pool.map((c) => [c.id, c]));
  const campusRows = await db.select({ id: campuses.id, name: campuses.name }).from(campuses).orderBy(asc(campuses.sortOrder));
  const campusName = new Map(campusRows.map((c) => [c.id, c.name]));
  const keys = new Set([...Object.keys(targets), ...Object.keys(selection.pool)]);
  const byCampus = [...keys]
    .map((key) => ({
      key,
      campusId: key === "school" ? null : key,
      name: key === "school" ? "Whole school" : (campusName.get(key) ?? "Unknown campus"),
      target: targets[key] ?? 0,
      selected: selection.byCampus[key] ?? 0,
      pool: selection.pool[key] ?? 0,
      shortfall: selection.shortfall[key] ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected = selection.selected.map((id) => ({ ...poolById.get(id)!, alreadyInvited: invited.has(id) }));
  return {
    selected,
    byCampus,
    totals: {
      target: Object.values(targets).reduce((n, v) => n + v, 0),
      selected: selected.length,
      shortfall: Object.values(selection.shortfall).reduce((n, v) => n + v, 0),
      pool: pool.length,
      alreadyInvited: invited.size,
    },
  };
}

// ── Requests & invitations ─────────────────────────────────────────────────

type ContributorRow = typeof contributors.$inferSelect;

async function contributorContext(contributorIds: string[]) {
  if (!contributorIds.length) return new Map<string, ContributorRow & { campusName: string | null }>();
  const rows = await db
    .select({ contributor: contributors, campusName: campuses.name })
    .from(contributors)
    .leftJoin(campuses, eq(campuses.id, contributors.campusId))
    .where(inArray(contributors.id, contributorIds));
  return new Map(rows.map((r) => [r.contributor.id, { ...r.contributor, campusName: r.campusName }]));
}

/** Inserts PENDING requests for contributors that do not have one yet; returns the new rows. */
async function createPendingRequests(campaign: Campaign, contributorIds: string[], now: Date): Promise<SubmissionRequest[]> {
  if (!contributorIds.length) return [];
  const people = await db.select({ id: contributors.id, campusId: contributors.campusId }).from(contributors).where(inArray(contributors.id, contributorIds));
  const tokenExpiresAt = defaultTokenExpiry(campaign.graceEndsAt, now);
  const values = people.map((c) => {
    const id = crypto.randomUUID();
    return {
      id,
      campaignId: campaign.id,
      editionId: campaign.editionId,
      contributorId: c.id,
      campusId: c.campusId,
      tokenHash: requestTokenHash(id, tokenExpiresAt),
      tokenExpiresAt,
      status: "PENDING" as const,
    };
  });
  return db.insert(submissionRequests).values(values).onConflictDoNothing({ target: [submissionRequests.campaignId, submissionRequests.contributorId] }).returning();
}

type SendResult = { sent: number; failed: number; links: { contributorId: string; requestId: string; link: string }[] };

/** Sends the invitation for each PENDING request (or every given request when `resend`). */
async function sendInvitations(campaign: Campaign, edition: Edition, requests: SubmissionRequest[], now: Date, opts: { resend?: boolean } = {}): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, links: [] };
  if (!requests.length) return result;
  const contact = await getContactSettings();
  const people = await contributorContext(requests.map((r) => r.contributorId));
  for (const request of requests) {
    const person = people.get(request.contributorId);
    if (!person || !person.isActive) continue;
    const link = contributionLink(mintRequestToken(request.id, request.tokenExpiresAt));
    const message = invitationEmail({
      contributor: { firstName: person.firstName, lastName: person.lastName, campusName: person.campusName },
      edition: { label: edition.label, issueNumber: edition.issueNumber, publicationTargetAt: edition.publicationTargetAt },
      campaign: { introMessage: campaign.introMessage, deadlineAt: campaign.deadlineAt, graceEndsAt: campaign.graceEndsAt },
      link,
      contactEmail: contact.email,
    });
    const outcome = await sendEmail({
      to: person.email,
      subject: message.subject,
      layout: message.layout,
      template: message.template,
      entityType: "CAMPAIGN",
      entityId: campaign.id,
      editionId: edition.id,
      contributorId: person.id,
    });
    if (!outcome.ok) {
      result.failed += 1;
      continue;
    }
    result.sent += 1;
    result.links.push({ contributorId: person.id, requestId: request.id, link });
    await db
      .update(submissionRequests)
      .set({ status: request.status === "PENDING" ? "SENT" : request.status, sentAt: opts.resend && request.sentAt ? request.sentAt : now })
      .where(eq(submissionRequests.id, request.id));
    if (!opts.resend) {
      await db
        .update(contributors)
        .set({ invitationsCount: sql`${contributors.invitationsCount} + 1`, lastInvitedAt: now })
        .where(eq(contributors.id, person.id));
    }
  }
  return result;
}

async function setEditionStatus(edition: Edition, to: EditionStatus, opts: { strictFrom?: EditionStatus } = {}): Promise<EditionStatus> {
  if (edition.status === to) return to;
  if (opts.strictFrom && edition.status === opts.strictFrom) assertTransition(edition.status, to);
  else if (!canTransition(edition.status, to)) {
    log.warn("edition status not changed", { editionId: edition.id, from: edition.status, to });
    return edition.status;
  }
  await db.update(editions).set({ status: to }).where(eq(editions.id, edition.id));
  return to;
}

export type OpenCampaignOptions = StepOptions & {
  /** Return the personal links that were generated (tests, manual export). Never logged. */
  collectLinks?: boolean;
};

export type OpenCampaignResult = {
  skipped: boolean;
  reason?: string;
  invited: number;
  byCampus: Record<string, number>;
  shortfall: Record<string, number>;
  emailsSent: number;
  emailsFailed: number;
  links?: { contributorId: string; requestId: string; link: string }[];
};

/**
 * Opens the campaign: selects contributors, creates their personal requests, sends the
 * invitations, moves the campaign and the edition to OPEN. Idempotent (`<editionId>:CAMPAIGN_OPEN`).
 */
export async function openCampaign(campaignId: string, opts: OpenCampaignOptions): Promise<OpenCampaignResult> {
  const now = opts.now ?? new Date();
  const { campaign, edition } = await loadCampaignWithEdition(campaignId);
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    return { skipped: true, reason: `Campaign is already ${campaign.status}`, invited: 0, byCampus: {}, shortfall: {}, emailsSent: 0, emailsFailed: 0 };
  }
  let links: OpenCampaignResult["links"];
  const step = await runStep({ editionId: edition.id, step: "CAMPAIGN_OPEN", runKey: `${edition.id}:CAMPAIGN_OPEN`, triggeredBy: opts.triggeredBy, scheduledFor: campaign.opensAt, now }, async () => {
    const pool = await loadEligibleContributors(campaign.contributorGroupIds);
    const { excludeIds, strictExclude } = await exclusionFor(campaign);
    const selection = selectContributors({ contributors: pool, groupIds: campaign.contributorGroupIds, targets: campaign.targets ?? {}, seed: campaign.id, excludeIds, strictExclude });
    await createPendingRequests(campaign, selection.selected, now);
    const pending = await db.select().from(submissionRequests).where(and(eq(submissionRequests.campaignId, campaign.id), eq(submissionRequests.status, "PENDING")));
    const sent = await sendInvitations(campaign, edition, pending, now);
    if (opts.collectLinks) links = sent.links;

    // Opening a campaign by hand before its scheduled day moves the opening to now. The phase is
    // derived from the dates, so leaving `opensAt` in the future would send every contributor a
    // personal link that answers "come back later" — invitations already in their inbox.
    const openedEarly = now.getTime() < new Date(campaign.opensAt).getTime();
    await db
      .update(submissionCampaigns)
      .set(openedEarly ? { status: "OPEN", opensAt: now } : { status: "OPEN" })
      .where(eq(submissionCampaigns.id, campaign.id));
    const editionStatus = await setEditionStatus(edition, "OPEN", { strictFrom: "UPCOMING" });

    const invitedTotal = await db.select({ n: count() }).from(submissionRequests).where(eq(submissionRequests.campaignId, campaign.id));
    const byCampus: Record<string, number> = {};
    const requestRows = await db.select({ campusId: submissionRequests.campusId }).from(submissionRequests).where(eq(submissionRequests.campaignId, campaign.id));
    for (const r of requestRows) byCampus[targetKeyFor({ campusId: r.campusId })] = (byCampus[targetKeyFor({ campusId: r.campusId })] ?? 0) + 1;

    await notifyEditors({
      type: "CONTRIBUTION_REQUEST",
      title: `Contribution campaign opened — ${edition.label}`,
      body: `${sent.sent} ${sent.sent === 1 ? "contributor" : "contributors"} invited${Object.values(selection.shortfall).some((n) => n > 0) ? " (some campus targets could not be met)" : ""}.`,
      entityType: "CAMPAIGN",
      entityId: campaign.id,
      href: `/editions/${edition.id}/contributors`,
    });
    await audit({
      action: "campaign.open",
      userId: opts.userId,
      actorType: opts.userId ? "USER" : "SYSTEM",
      entityType: "CAMPAIGN",
      entityId: campaign.id,
      editionId: edition.id,
      metadata: { triggeredBy: opts.triggeredBy, invited: invitedTotal[0]?.n ?? 0, emailsSent: sent.sent, emailsFailed: sent.failed, shortfall: selection.shortfall, editionStatus },
    });
    return { invited: invitedTotal[0]?.n ?? 0, byCampus, shortfall: selection.shortfall, emailsSent: sent.sent, emailsFailed: sent.failed };
  });
  if (step.status === "skipped") {
    return { skipped: true, reason: `CAMPAIGN_OPEN already ${step.reason}`, invited: 0, byCampus: {}, shortfall: {}, emailsSent: 0, emailsFailed: 0 };
  }
  return { skipped: false, ...step.result, ...(opts.collectLinks ? { links: links ?? [] } : {}) };
}

// ── Reminders ──────────────────────────────────────────────────────────────

export type ReminderResult = { skipped: boolean; reason?: string; targeted: number; emailsSent: number; emailsFailed: number; tokensRenewed: number };

const REMINDER_STEP: Record<ReminderKind, { step: "REMINDER_1" | "REMINDER_2" | "GRACE_PERIOD"; scheduledFor: (c: Campaign) => Date; editionStatus: EditionStatus }> = {
  REMINDER_1: { step: "REMINDER_1", scheduledFor: (c) => c.reminder1At, editionStatus: "REMINDER_1" },
  REMINDER_2: { step: "REMINDER_2", scheduledFor: (c) => c.reminder2At, editionStatus: "REMINDER_2" },
  GRACE_PERIOD: { step: "GRACE_PERIOD", scheduledFor: (c) => c.deadlineAt, editionStatus: "GRACE_PERIOD" },
};

/**
 * Sends a reminder to every invited contributor who has not submitted or declined, with the
 * same personal link (renewed when expired). Idempotent (`<editionId>:<kind>`).
 */
export async function sendReminders(campaignId: string, kind: ReminderKind, opts: StepOptions): Promise<ReminderResult> {
  const now = opts.now ?? new Date();
  const { campaign, edition } = await loadCampaignWithEdition(campaignId);
  if (campaign.status === "CLOSED") return { skipped: true, reason: "Campaign is closed", targeted: 0, emailsSent: 0, emailsFailed: 0, tokensRenewed: 0 };
  if (campaign.status === "DRAFT" || campaign.status === "SCHEDULED") return { skipped: true, reason: "Campaign is not open yet", targeted: 0, emailsSent: 0, emailsFailed: 0, tokensRenewed: 0 };
  const spec = REMINDER_STEP[kind];
  const step = await runStep({ editionId: edition.id, step: spec.step, runKey: `${edition.id}:${kind}`, triggeredBy: opts.triggeredBy, scheduledFor: spec.scheduledFor(campaign), now }, async () => {
    const requests = await db
      .select()
      .from(submissionRequests)
      .where(and(eq(submissionRequests.campaignId, campaign.id), inArray(submissionRequests.status, [...REMINDABLE_REQUEST_STATUSES])));
    const people = await contributorContext(requests.map((r) => r.contributorId));
    const contact = await getContactSettings();
    let emailsSent = 0;
    let emailsFailed = 0;
    let tokensRenewed = 0;
    for (const request of requests) {
      const person = people.get(request.contributorId);
      if (!person || !person.isActive) continue;
      let tokenExpiresAt = request.tokenExpiresAt;
      if (tokenExpiresAt.getTime() <= now.getTime()) {
        tokenExpiresAt = defaultTokenExpiry(campaign.graceEndsAt, now);
        await db.update(submissionRequests).set({ tokenExpiresAt, tokenHash: requestTokenHash(request.id, tokenExpiresAt) }).where(eq(submissionRequests.id, request.id));
        tokensRenewed += 1;
      }
      const link = contributionLink(mintRequestToken(request.id, tokenExpiresAt));
      const message = reminderEmail(kind, {
        contributor: { firstName: person.firstName, lastName: person.lastName, campusName: person.campusName },
        edition: { label: edition.label, issueNumber: edition.issueNumber, publicationTargetAt: edition.publicationTargetAt },
        campaign: { introMessage: campaign.introMessage, deadlineAt: campaign.deadlineAt, graceEndsAt: campaign.graceEndsAt },
        link,
        contactEmail: contact.email,
        now,
      });
      const outcome = await sendEmail({
        to: person.email,
        subject: message.subject,
        layout: message.layout,
        template: message.template,
        entityType: "CAMPAIGN",
        entityId: campaign.id,
        editionId: edition.id,
        contributorId: person.id,
      });
      if (!outcome.ok) {
        emailsFailed += 1;
        continue;
      }
      emailsSent += 1;
      await db
        .update(submissionRequests)
        .set({ remindedCount: sql`${submissionRequests.remindedCount} + 1`, lastRemindedAt: now })
        .where(eq(submissionRequests.id, request.id));
    }
    await db.update(submissionCampaigns).set({ status: kind }).where(eq(submissionCampaigns.id, campaign.id));
    const editionStatus = await setEditionStatus(edition, spec.editionStatus);
    await audit({
      action: `campaign.${kind.toLowerCase()}`,
      userId: opts.userId,
      actorType: opts.userId ? "USER" : "SYSTEM",
      entityType: "CAMPAIGN",
      entityId: campaign.id,
      editionId: edition.id,
      metadata: { triggeredBy: opts.triggeredBy, targeted: requests.length, emailsSent, emailsFailed, tokensRenewed, editionStatus },
    });
    return { targeted: requests.length, emailsSent, emailsFailed, tokensRenewed };
  });
  if (step.status === "skipped") return { skipped: true, reason: `${kind} already ${step.reason}`, targeted: 0, emailsSent: 0, emailsFailed: 0, tokensRenewed: 0 };
  return { skipped: false, ...step.result };
}

// ── Close / reopen / extend ────────────────────────────────────────────────

export type CloseCampaignOptions = StepOptions & {
  /** Force-skip the AI processing job even when the campaign asks for it (automation toggle off). */
  skipProcessing?: boolean;
};

export type CloseCampaignResult = { skipped: boolean; reason?: string; submissions: number; contributors: number; thankYouEmails: number; processingQueued: boolean };

/**
 * Closes the campaign: campaign + edition CLOSED, thank-you emails, AI processing job when
 * `autoProcess`. Idempotent (`<editionId>:CAMPAIGN_CLOSE`).
 */
export async function closeCampaign(campaignId: string, opts: CloseCampaignOptions): Promise<CloseCampaignResult> {
  const now = opts.now ?? new Date();
  const { campaign, edition } = await loadCampaignWithEdition(campaignId);
  if (campaign.status === "CLOSED") return { skipped: true, reason: "Campaign is already closed", submissions: 0, contributors: 0, thankYouEmails: 0, processingQueued: false };
  const step = await runStep({ editionId: edition.id, step: "CAMPAIGN_CLOSE", runKey: `${edition.id}:CAMPAIGN_CLOSE`, triggeredBy: opts.triggeredBy, scheduledFor: campaign.graceEndsAt, now }, async () => {
    await db.update(submissionCampaigns).set({ status: "CLOSED", closedAt: now }).where(eq(submissionCampaigns.id, campaign.id));
    let current = edition.status;
    if (current === "UPCOMING") {
      // A campaign closed without ever opening (manual close): walk through OPEN so the state machine stays honest.
      assertTransition("UPCOMING", "OPEN");
      await db.update(editions).set({ status: "OPEN" }).where(eq(editions.id, edition.id));
      current = "OPEN";
    }
    const editionStatus = await setEditionStatus({ ...edition, status: current }, "CLOSED");

    const [subs] = await db
      .select({ n: count() })
      .from(submissions)
      .where(and(eq(submissions.editionId, edition.id), ne(submissions.status, "DRAFT")));
    const submitted = await db
      .select()
      .from(submissionRequests)
      .where(and(eq(submissionRequests.campaignId, campaign.id), eq(submissionRequests.status, "SUBMITTED")));
    const people = await contributorContext(submitted.map((r) => r.contributorId));
    const contact = await getContactSettings();
    let thankYouEmails = 0;
    for (const request of submitted) {
      const person = people.get(request.contributorId);
      if (!person) continue;
      const message = closedEmail({
        contributor: { firstName: person.firstName, lastName: person.lastName, campusName: person.campusName },
        edition: { label: edition.label, issueNumber: edition.issueNumber, publicationTargetAt: edition.publicationTargetAt },
        submissionsCount: request.submissionsCount,
        contactEmail: contact.email,
      });
      const outcome = await sendEmail({ to: person.email, subject: message.subject, layout: message.layout, template: message.template, entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, contributorId: person.id });
      if (outcome.ok) thankYouEmails += 1;
    }

    let processingQueued = false;
    if (campaign.autoProcess && !opts.skipProcessing) {
      await enqueueJob({ type: JOB_TYPES.EDITION_PROCESS, payload: { editionId: edition.id }, idempotencyKey: `edition-process:${edition.id}`, editionId: edition.id, createdById: opts.userId ?? null, priority: 3 });
      kickJobRunner();
      processingQueued = true;
    }

    await notifyEditors({
      type: "SYSTEM",
      title: `Contributions closed — ${edition.label}`,
      body: `${subs?.n ?? 0} ${subs?.n === 1 ? "submission" : "submissions"} from ${submitted.length} ${submitted.length === 1 ? "contributor" : "contributors"}.${processingQueued ? " AI processing has started." : ""}`,
      entityType: "EDITION",
      entityId: edition.id,
      href: `/editions/${edition.id}/inbox`,
    });
    await audit({
      action: "campaign.close",
      userId: opts.userId,
      actorType: opts.userId ? "USER" : "SYSTEM",
      entityType: "CAMPAIGN",
      entityId: campaign.id,
      editionId: edition.id,
      metadata: { triggeredBy: opts.triggeredBy, submissions: subs?.n ?? 0, contributors: submitted.length, thankYouEmails, processingQueued, editionStatus },
    });
    return { submissions: subs?.n ?? 0, contributors: submitted.length, thankYouEmails, processingQueued };
  });
  if (step.status === "skipped") return { skipped: true, reason: `CAMPAIGN_CLOSE already ${step.reason}`, submissions: 0, contributors: 0, thankYouEmails: 0, processingQueued: false };
  return { skipped: false, ...step.result };
}

/** Extends the token expiry of every non-final request to match the campaign's grace period. */
async function extendRequestTokens(campaign: Campaign, now = new Date()) {
  const expiresAt = defaultTokenExpiry(campaign.graceEndsAt, now);
  const rows = await db
    .select({ id: submissionRequests.id, tokenExpiresAt: submissionRequests.tokenExpiresAt })
    .from(submissionRequests)
    .where(and(eq(submissionRequests.campaignId, campaign.id), inArray(submissionRequests.status, ["PENDING", "SENT", "OPENED", "SUBMITTED"])));
  let renewed = 0;
  for (const r of rows) {
    if (r.tokenExpiresAt.getTime() >= expiresAt.getTime()) continue;
    await db.update(submissionRequests).set({ tokenExpiresAt: expiresAt, tokenHash: requestTokenHash(r.id, expiresAt) }).where(eq(submissionRequests.id, r.id));
    renewed += 1;
  }
  return renewed;
}

/** Reopens a closed campaign until `graceEndsAt` (default: two more days). The edition goes back to collecting. */
export async function reopenCampaign(campaignId: string, input: { graceEndsAt?: Date; userId?: string | null; now?: Date }): Promise<Campaign> {
  const now = input.now ?? new Date();
  const { campaign, edition } = await loadCampaignWithEdition(campaignId);
  if (campaign.status !== "CLOSED") throw new AppError("Only a closed campaign can be reopened", "CAMPAIGN_NOT_CLOSED", 409);
  const graceEndsAt = input.graceEndsAt ?? addDays(now, 2);
  if (graceEndsAt.getTime() <= now.getTime()) throw new ValidationError("The new closing date must be in the future", { graceEndsAt: ["Must be in the future"] });
  if (!canTransition(edition.status, "OPEN")) throw new AppError(`The edition is ${edition.status} and cannot go back to collecting`, "EDITION_LOCKED", 409);

  const [updated] = await db
    .update(submissionCampaigns)
    .set({ status: "GRACE_PERIOD", closedAt: null, graceEndsAt, deadlineAt: campaign.deadlineAt.getTime() < graceEndsAt.getTime() ? campaign.deadlineAt : graceEndsAt })
    .where(eq(submissionCampaigns.id, campaign.id))
    .returning();
  assertTransition(edition.status, "OPEN");
  await db.update(editions).set({ status: "OPEN" }).where(eq(editions.id, edition.id));
  await db.update(editions).set({ status: "GRACE_PERIOD" }).where(eq(editions.id, edition.id));
  await releaseRun(`${edition.id}:CAMPAIGN_CLOSE`);
  await releaseRun(`${edition.id}:COVERAGE_CHECK`);
  const renewed = await extendRequestTokens(updated, now);
  await audit({ action: "campaign.reopen", userId: input.userId, entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, metadata: { graceEndsAt: graceEndsAt.toISOString(), tokensRenewed: renewed } });
  return updated;
}

/** Moves the end of the grace period of an open campaign (and renews the personal links). */
export async function extendCampaign(campaignId: string, input: { graceEndsAt: Date; userId?: string | null; now?: Date }): Promise<Campaign> {
  const now = input.now ?? new Date();
  const { campaign, edition } = await loadCampaignWithEdition(campaignId);
  if (campaign.status === "CLOSED") throw new AppError("The campaign is closed — reopen it instead", "CAMPAIGN_CLOSED", 409);
  const graceEndsAt = input.graceEndsAt;
  if (!(graceEndsAt instanceof Date) || Number.isNaN(graceEndsAt.getTime())) throw new ValidationError("Enter a valid date", { graceEndsAt: ["Enter a valid date"] });
  if (graceEndsAt.getTime() <= now.getTime()) throw new ValidationError("The new closing date must be in the future", { graceEndsAt: ["Must be in the future"] });
  if (graceEndsAt.getTime() <= campaign.deadlineAt.getTime()) throw new ValidationError("The grace period must end after the deadline", { graceEndsAt: ["Must be after the deadline"] });
  const [updated] = await db.update(submissionCampaigns).set({ graceEndsAt }).where(eq(submissionCampaigns.id, campaign.id)).returning();
  const renewed = await extendRequestTokens(updated, now);
  await audit({ action: "campaign.extend", userId: input.userId, entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, metadata: { from: campaign.graceEndsAt.toISOString(), to: graceEndsAt.toISOString(), tokensRenewed: renewed } });
  return updated;
}

// ── Stats ──────────────────────────────────────────────────────────────────

export type CampaignStats = {
  campaignId: string;
  status: CampaignStatus;
  phase: CampaignPhase;
  invited: number;
  sent: number;
  opened: number;
  submitted: number;
  declined: number;
  pending: number;
  submissions: number;
  responseRate: number;
  byCampus: { campusId: string | null; name: string; slug: string | null; colour: string | null; invited: number; submitted: number; submissions: number }[];
  timeline: { date: string; submissions: number }[];
};

export async function campaignStats(campaignId: string, now = new Date()): Promise<CampaignStats> {
  const campaign = await getCampaign(campaignId);
  const requests = await db
    .select({ status: submissionRequests.status, campusId: submissionRequests.campusId, openedAt: submissionRequests.openedAt, sentAt: submissionRequests.sentAt })
    .from(submissionRequests)
    .where(eq(submissionRequests.campaignId, campaignId));
  const invited = requests.length;
  const sent = requests.filter((r) => r.sentAt).length;
  const opened = requests.filter((r) => r.openedAt).length;
  const submitted = requests.filter((r) => r.status === "SUBMITTED").length;
  const declined = requests.filter((r) => r.status === "DECLINED").length;
  const pending = requests.filter((r) => r.status === "PENDING").length;

  const [subs] = await db
    .select({ n: count() })
    .from(submissions)
    .where(and(eq(submissions.campaignId, campaignId), ne(submissions.status, "DRAFT")));

  const campusRows = await db.select({ id: campuses.id, name: campuses.name, slug: campuses.slug, colour: campuses.colour }).from(campuses).where(eq(campuses.isActive, true)).orderBy(asc(campuses.sortOrder));
  const perCampusSubmissions = await db
    .select({ campusId: submissionCampuses.campusId, n: count() })
    .from(submissionCampuses)
    .innerJoin(submissions, eq(submissions.id, submissionCampuses.submissionId))
    .where(and(eq(submissions.campaignId, campaignId), ne(submissions.status, "DRAFT")))
    .groupBy(submissionCampuses.campusId);
  const [schoolWide] = await db
    .select({ n: count() })
    .from(submissions)
    .where(and(eq(submissions.campaignId, campaignId), ne(submissions.status, "DRAFT"), eq(submissions.campusScope, "SCHOOL_WIDE")));
  const subsByCampus = new Map(perCampusSubmissions.map((r) => [r.campusId, r.n]));
  const byCampus: CampaignStats["byCampus"] = campusRows.map((c) => ({
    campusId: c.id,
    name: c.name,
    slug: c.slug,
    colour: c.colour,
    invited: requests.filter((r) => r.campusId === c.id).length,
    submitted: requests.filter((r) => r.campusId === c.id && r.status === "SUBMITTED").length,
    submissions: subsByCampus.get(c.id) ?? 0,
  }));
  byCampus.push({
    campusId: null,
    name: "Whole school",
    slug: null,
    colour: null,
    invited: requests.filter((r) => !r.campusId).length,
    submitted: requests.filter((r) => !r.campusId && r.status === "SUBMITTED").length,
    submissions: schoolWide?.n ?? 0,
  });

  const timelineRows = await db
    .select({ date: sql<string>`to_char(${submissions.submittedAt} at time zone 'Europe/Paris', 'YYYY-MM-DD')`, n: count() })
    .from(submissions)
    .where(and(eq(submissions.campaignId, campaignId), ne(submissions.status, "DRAFT"), isNotNull(submissions.submittedAt)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return {
    campaignId,
    status: campaign.status,
    phase: campaignPhaseAt(campaign, now),
    invited,
    sent,
    opened,
    submitted,
    declined,
    pending,
    submissions: subs?.n ?? 0,
    responseRate: invited ? Math.round((submitted / invited) * 1000) / 1000 : 0,
    byCampus,
    timeline: timelineRows.map((r) => ({ date: r.date, submissions: r.n })),
  };
}

// ── Manual operations ──────────────────────────────────────────────────────

/** Re-sends the invitation with a freshly rotated personal link. */
export async function resendInvitation(requestId: string, user: Actor, now = new Date()): Promise<{ ok: boolean; link?: string }> {
  const request = await db.query.submissionRequests.findFirst({ where: eq(submissionRequests.id, requestId) });
  if (!request) throw new NotFoundError("Invitation");
  const { campaign, edition } = await loadCampaignWithEdition(request.campaignId);
  if (campaign.status === "CLOSED") throw new AppError("The campaign is closed", "CAMPAIGN_CLOSED", 409);
  const tokenExpiresAt = rotatedTokenExpiry(campaign.graceEndsAt, now);
  const [renewed] = await db
    .update(submissionRequests)
    .set({ tokenExpiresAt, tokenHash: requestTokenHash(request.id, tokenExpiresAt), status: request.status === "DECLINED" || request.status === "EXPIRED" || request.status === "BOUNCED" ? "SENT" : request.status })
    .where(eq(submissionRequests.id, request.id))
    .returning();
  const result = await sendInvitations(campaign, edition, [renewed], now, { resend: true });
  await audit({ action: "campaign.resend_invitation", userId: user?.id, entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, metadata: { requestId, contributorId: request.contributorId, sent: result.sent } });
  return { ok: result.sent === 1 };
}

/** Adds contributors to a campaign; invitations go out immediately when the campaign is open. */
export async function addContributorsToCampaign(campaignId: string, contributorIds: string[], user: Actor, now = new Date()): Promise<{ added: number; sent: number }> {
  const ids = [...new Set(contributorIds)].filter((id) => z.uuid().safeParse(id).success);
  if (!ids.length) throw new ValidationError("Select at least one contributor", { contributorIds: ["Select at least one contributor"] });
  const { campaign, edition } = await loadCampaignWithEdition(campaignId);
  if (campaign.status === "CLOSED") throw new AppError("The campaign is closed", "CAMPAIGN_CLOSED", 409);
  const created = await createPendingRequests(campaign, ids, now);
  let sent = 0;
  if (ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status) && created.length) {
    const result = await sendInvitations(campaign, edition, created, now);
    sent = result.sent;
  }
  await audit({ action: "campaign.add_contributors", userId: user?.id, entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, metadata: { requested: ids.length, added: created.length, sent } });
  return { added: created.length, sent };
}

/** Requests of a campaign with their contributor, for the newsroom's contributors tab. */
export async function listCampaignRequests(campaignId: string) {
  return db
    .select({
      request: submissionRequests,
      contributor: { id: contributors.id, firstName: contributors.firstName, lastName: contributors.lastName, email: contributors.email, type: contributors.type, campusId: contributors.campusId },
      campusName: campuses.name,
    })
    .from(submissionRequests)
    .innerJoin(contributors, eq(contributors.id, submissionRequests.contributorId))
    .leftJoin(campuses, eq(campuses.id, submissionRequests.campusId))
    .where(eq(submissionRequests.campaignId, campaignId))
    .orderBy(asc(campuses.sortOrder), asc(contributors.lastName));
}
