/**
 * Automation scheduler.
 *
 * `runAutomationTick` is called by the cron endpoint (/api/automations/tick), the
 * AUTOMATION_TICK job or a manual "Run now" in the newsroom. Every step is idempotent through
 * `automation_runs`, so the tick can run as often as every few minutes without side effects.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, max } from "drizzle-orm";
import { db } from "@/server/db/client";
import { articles, automationRuns, campuses, editionSections, editions, organizations, publications, submissionCampaigns } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { createLogger } from "@/server/logger";
import { PRODUCTION_STATUSES } from "@/lib/editorial/edition-state";
import {
  addDays,
  campaignPhaseAt,
  computeCampaignSchedule,
  editionLabel,
  formatZoned,
  nextEditionMonth,
  type CampaignDefaults,
} from "@/lib/campaigns/schedule";
import { slugify } from "@/lib/utils";
import { coverageByCampus } from "./coverage";
import { deadlineAlertEmail, lowCoverageEmail } from "./emails";
import { listEditors, notifyEditors } from "./notify";
import { recordSkippedRun, runStep, type AutomationRun, type TriggeredBy } from "./runs";
import { closeCampaign, createOrUpdateCampaign, openCampaign, sendReminders, type Campaign } from "./service";
import { AUTOMATION_KEYS, getAutomationToggles, getCampaignDefaults, getDefaultSections, type AutomationKey, type AutomationToggles } from "./settings";

const log = createLogger("campaigns:scheduler");

/** The next edition is created when its campaign opens within this window. */
export const EDITION_CREATION_WINDOW_DAYS = 40;
/** Coverage is checked once, shortly after a campaign closes. */
const COVERAGE_CHECK_WINDOW_DAYS = 14;
const DEADLINE_ALERT_WINDOW_MS = 24 * 60 * 60_000;

export type TickResult = { now: string; ran: string[]; skipped: string[]; errors: string[] };

export type TickOptions = { now?: Date; triggeredBy?: TriggeredBy };

export async function runAutomationTick(opts: TickOptions = {}): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const triggeredBy = opts.triggeredBy ?? "SCHEDULER";
  const result: TickResult = { now: now.toISOString(), ran: [], skipped: [], errors: [] };
  const toggles = await getAutomationToggles();
  const defaults = await getCampaignDefaults();
  log.info("tick", { now: result.now, triggeredBy });

  // 1. Next edition
  try {
    if (toggles.editionCreation) {
      const outcome = await ensureNextEdition({ now, defaults, triggeredBy });
      (outcome.created ? result.ran : result.skipped).push(`EDITION_CREATION:${outcome.label}${outcome.created ? "" : ` (${outcome.reason})`}`);
    } else result.skipped.push("EDITION_CREATION (disabled)");
  } catch (err) {
    result.errors.push(`EDITION_CREATION: ${errorMessage(err)}`);
  }

  // 2. Campaign lifecycle
  const active = await db
    .select()
    .from(submissionCampaigns)
    .where(inArray(submissionCampaigns.status, ["SCHEDULED", "OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD"]))
    .orderBy(asc(submissionCampaigns.opensAt));
  for (const campaign of active) {
    try {
      await processCampaign(campaign, { now, toggles, triggeredBy, result });
    } catch (err) {
      result.errors.push(`CAMPAIGN ${campaign.id}: ${errorMessage(err)}`);
    }
  }

  // 3. Deadline alerts
  try {
    if (toggles.deadlineAlert) await deadlineAlerts({ now, triggeredBy, result });
    else result.skipped.push("DEADLINE_ALERT (disabled)");
  } catch (err) {
    result.errors.push(`DEADLINE_ALERT: ${errorMessage(err)}`);
  }

  // 4. Coverage checks
  try {
    if (toggles.coverageCheck) await coverageChecks({ now, triggeredBy, result });
    else result.skipped.push("COVERAGE_CHECK (disabled)");
  } catch (err) {
    result.errors.push(`COVERAGE_CHECK: ${errorMessage(err)}`);
  }

  // 5. The newsroom mailbox: replies from contributors become submissions to triage.
  try {
    const { pollInbox } = await import("@/server/email/inbound");
    const inbox = await pollInbox();
    if (inbox.filed) result.ran.push(`MAILBOX: ${inbox.filed} repl${inbox.filed === 1 ? "y" : "ies"} filed`);
    else if (inbox.polled) result.skipped.push(`MAILBOX (${inbox.polled} message(s), nothing to file)`);
    else result.skipped.push("MAILBOX (no new message)");
  } catch (err) {
    result.errors.push(`MAILBOX: ${errorMessage(err)}`);
  }

  // 6. Paid readers: a subscription that ended at Stripe ends here, whichever way it ended.
  try {
    const { syncPaidReaders } = await import("@/server/payments/readers");
    const paid = await syncPaidReaders(now);
    if (paid.checked || paid.errors) result.ran.push(`PAID_READERS: ${paid.checked} checked, ${paid.stopped} stopped${paid.errors ? `, ${paid.errors} could not be checked` : ""}`);
    else result.skipped.push("PAID_READERS (nothing due)");
  } catch (err) {
    result.errors.push(`PAID_READERS: ${errorMessage(err)}`);
  }

  log.info("tick done", { ran: result.ran.length, skipped: result.skipped.length, errors: result.errors });
  return result;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// ── Step 1: edition creation ───────────────────────────────────────────────

/**
 * The next edition, for every workspace that publishes.
 *
 * This step predates multi-tenancy and quietly assumed one customer: it took the highest issue
 * number across the whole table, wrote the masthead of the first customer Briefly ever had, and
 * inserted a row belonging to nobody. With one workspace that looked correct. With two it means a
 * customer's issue numbering jumps because somebody else published, and an edition with no owner
 * that no workspace can see. So the step now runs once per workspace, inside that workspace, and
 * every number, name and row belongs to it.
 */
export async function ensureNextEdition(input: { now: Date; defaults: CampaignDefaults; triggeredBy: TriggeredBy }): Promise<{ created: boolean; editionId: string | null; label: string; reason?: string }> {
  const { runAsOrganization } = await import("@/server/tenancy/context");
  // Briefly's own gallery workspaces are not newsrooms: nobody is waiting for their next issue,
  // and running them would invent editions, send nothing and cost money every month.
  const owners = await db
    .selectDistinct({ organizationId: editions.organizationId })
    .from(editions)
    .innerJoin(organizations, eq(organizations.id, editions.organizationId))
    .where(and(isNotNull(editions.organizationId), eq(organizations.isDemo, false)));
  const { month, year } = nextEditionMonth(input.now);
  const label = editionLabel(month, year);
  let last: { created: boolean; editionId: string | null; label: string; reason?: string } = { created: false, editionId: null, label, reason: "no workspace publishes yet" };
  for (const owner of owners) {
    last = await runAsOrganization(owner.organizationId!, () => ensureNextEditionFor(owner.organizationId!, input));
    if (last.created) break;
  }
  return last;
}

async function ensureNextEditionFor(organizationId: string, input: { now: Date; defaults: CampaignDefaults; triggeredBy: TriggeredBy }): Promise<{ created: boolean; editionId: string | null; label: string; reason?: string }> {
  const { month, year } = nextEditionMonth(input.now);
  const label = editionLabel(month, year);
  const schedule = computeCampaignSchedule({ month, year, defaults: input.defaults });
  const existing = await db.query.editions.findFirst({ where: and(eq(editions.organizationId, organizationId), eq(editions.month, month), eq(editions.year, year)) });
  if (existing) return { created: false, editionId: existing.id, label, reason: "already exists" };
  const daysUntilOpen = (schedule.opensAt.getTime() - input.now.getTime()) / 86_400_000;
  if (daysUntilOpen > EDITION_CREATION_WINDOW_DAYS) return { created: false, editionId: null, label, reason: `campaign opens in ${Math.ceil(daysUntilOpen)} days` };

  const [maxRow] = await db.select({ n: max(editions.issueNumber) }).from(editions).where(eq(editions.organizationId, organizationId));
  const issueNumber = (maxRow?.n ?? 0) + 1;
  const monthSlug = slugify(label);
  // The masthead is the workspace's own recurring title, not the first customer Briefly ever had.
  const publication = await db.query.publications.findFirst({ where: eq(publications.organizationId, organizationId), orderBy: [asc(publications.sortOrder), asc(publications.createdAt)] });
  const [edition] = await db
    .insert(editions)
    .values({
      organizationId,
      publicationId: publication?.id ?? null,
      issueNumber,
      title: `${publication?.name ?? "Edition"} — Issue N°${issueNumber}`,
      slug: `issue-${issueNumber}-${monthSlug}`,
      label,
      month,
      year,
      status: "UPCOMING",
      publicationTargetAt: schedule.publicationTargetAt,
      finalReviewAt: schedule.finalReviewAt,
    })
    .returning();
  const sections = await getDefaultSections();
  if (sections.length) {
    await db.insert(editionSections).values(sections.map((s, i) => ({ editionId: edition.id, slug: s.slug, name: s.name, kicker: s.kicker ?? null, colour: s.colour ?? null, sortOrder: i, targetPages: s.targetPages ?? null })));
  }
  // Campaign from defaults, inheriting targets and groups from the most recent campaign.
  const defaultTargetsFromCampuses = async (): Promise<Record<string, number>> => {
    const active = await db.select({ id: campuses.id, defaultInviteTarget: campuses.defaultInviteTarget }).from(campuses).where(eq(campuses.isActive, true));
    return Object.fromEntries([...active.map((c) => [c.id, c.defaultInviteTarget] as const), ["school", 0] as const]);
  };
  const previous = await db.query.submissionCampaigns.findFirst({ orderBy: [desc(submissionCampaigns.opensAt)] });
  await createOrUpdateCampaign(
    edition.id,
    {
      name: `${label} contributions`,
      opensAt: schedule.opensAt,
      reminder1At: schedule.reminder1At,
      reminder2At: schedule.reminder2At,
      deadlineAt: schedule.deadlineAt,
      graceEndsAt: schedule.graceEndsAt,
      targets: previous?.targets ?? (await defaultTargetsFromCampuses()),
      contributorGroupIds: previous?.contributorGroupIds ?? [],
      introMessage: previous?.introMessage ?? "Tell us what happened around you this month: Business Deep Dives, events, associations, achievements and photos.",
      autoProcess: previous?.autoProcess ?? true,
      reinvitePrevious: previous?.reinvitePrevious ?? false,
    },
    null,
  );
  await runStep({ editionId: edition.id, step: "EDITION_CREATION", runKey: `${edition.id}:EDITION_CREATION`, triggeredBy: input.triggeredBy, scheduledFor: input.now, now: input.now }, async () => ({ editionId: edition.id, issueNumber, label }));
  await notifyEditors({ type: "SYSTEM", title: `${label} edition created`, body: `Issue N°${issueNumber}. Contributions open ${formatZoned(schedule.opensAt)}.`, entityType: "EDITION", entityId: edition.id, href: `/editions/${edition.id}` });
  await audit({ action: "edition.create", actorType: "SYSTEM", entityType: "EDITION", entityId: edition.id, editionId: edition.id, metadata: { issueNumber, label, automated: true } });
  log.info("edition created", { editionId: edition.id, label, issueNumber });
  return { created: true, editionId: edition.id, label };
}

// ── Step 2: campaign lifecycle ─────────────────────────────────────────────

const REMINDER_ORDER = ["OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD"] as const;

async function processCampaign(initial: Campaign, ctx: { now: Date; toggles: AutomationToggles; triggeredBy: TriggeredBy; result: TickResult }) {
  const { now, toggles, triggeredBy, result } = ctx;
  const t = now.getTime();
  const tag = (step: string) => `${step}:${initial.editionId}`;
  let campaign = initial;
  const reload = async () => {
    const row = await db.query.submissionCampaigns.findFirst({ where: eq(submissionCampaigns.id, initial.id) });
    if (row) campaign = row;
  };
  const stepOpts = { triggeredBy, now };

  if (campaign.status === "SCHEDULED") {
    if (t < campaign.opensAt.getTime()) return;
    if (!toggles.contributionRequest) {
      await recordSkippedRun({ editionId: campaign.editionId, step: "CAMPAIGN_OPEN", runKey: `${campaign.editionId}:CAMPAIGN_OPEN`, triggeredBy, scheduledFor: campaign.opensAt, now }, "contributionRequest disabled");
      result.skipped.push(`${tag("CAMPAIGN_OPEN")} (disabled)`);
      return;
    }
    const opened = await openCampaign(campaign.id, stepOpts);
    (opened.skipped ? result.skipped : result.ran).push(`${tag("CAMPAIGN_OPEN")}${opened.skipped ? ` (${opened.reason})` : ` (${opened.invited} invited)`}`);
    await reload();
  }

  const stage = () => REMINDER_ORDER.indexOf(campaign.status as (typeof REMINDER_ORDER)[number]);
  const reminders: { kind: "REMINDER_1" | "REMINDER_2" | "GRACE_PERIOD"; at: Date; toggle: AutomationKey; index: number }[] = [
    { kind: "REMINDER_1", at: campaign.reminder1At, toggle: "reminder1", index: 1 },
    { kind: "REMINDER_2", at: campaign.reminder2At, toggle: "reminder2", index: 2 },
    { kind: "GRACE_PERIOD", at: campaign.deadlineAt, toggle: "gracePeriod", index: 3 },
  ];
  for (const r of reminders) {
    if (stage() < 0 || stage() >= r.index || t < r.at.getTime()) continue;
    if (!toggles[r.toggle]) {
      await recordSkippedRun({ editionId: campaign.editionId, step: r.kind, runKey: `${campaign.editionId}:${r.kind}`, triggeredBy, scheduledFor: r.at, now }, `${r.toggle} disabled`);
      result.skipped.push(`${tag(r.kind)} (disabled)`);
      continue;
    }
    const sent = await sendReminders(campaign.id, r.kind, stepOpts);
    (sent.skipped ? result.skipped : result.ran).push(`${tag(r.kind)}${sent.skipped ? ` (${sent.reason})` : ` (${sent.emailsSent} emails)`}`);
    await reload();
  }

  if (stage() >= 0 && t >= campaign.graceEndsAt.getTime()) {
    const closed = await closeCampaign(campaign.id, { ...stepOpts, skipProcessing: !toggles.aiProcessing });
    (closed.skipped ? result.skipped : result.ran).push(`${tag("CAMPAIGN_CLOSE")}${closed.skipped ? ` (${closed.reason})` : ` (${closed.submissions} submissions)`}`);
  }
}

// ── Step 3: deadline alerts ────────────────────────────────────────────────

async function deadlineAlerts(ctx: { now: Date; triggeredBy: TriggeredBy; result: TickResult }) {
  const { now, triggeredBy, result } = ctx;
  const due = await db
    .select()
    .from(editions)
    .where(
      and(
        inArray(editions.status, [...PRODUCTION_STATUSES]),
        isNotNull(editions.finalReviewAt),
        gte(editions.finalReviewAt, now),
        lte(editions.finalReviewAt, new Date(now.getTime() + DEADLINE_ALERT_WINDOW_MS)),
      ),
    );
  for (const edition of due) {
    const step = await runStep({ editionId: edition.id, step: "DEADLINE_ALERT", runKey: `${edition.id}:DEADLINE_ALERT`, triggeredBy, scheduledFor: edition.finalReviewAt, now }, async () => {
      const rows = await db.select({ status: articles.status }).from(articles).where(eq(articles.editionId, edition.id));
      const total = rows.length;
      const approved = rows.filter((a) => a.status === "APPROVED" || a.status === "LOCKED").length;
      const title = `Final editorial review — ${formatZoned(edition.finalReviewAt)}`;
      const body = `${approved} of ${total} articles are approved.`;
      const href = `/editions/${edition.id}/articles`;
      const notified = await notifyEditors({ type: "DEADLINE_APPROACHING", title, body, entityType: "EDITION", entityId: edition.id, href });
      const message = deadlineAlertEmail({ edition: { label: edition.label, issueNumber: edition.issueNumber }, finalReviewAt: edition.finalReviewAt!, approved, total, link: `${env.NEXT_PUBLIC_APP_URL}${href}` });
      let emails = 0;
      for (const editor of await listEditors()) {
        const sent = await sendEmail({ to: editor.email, subject: message.subject, layout: message.layout, template: message.template, entityType: "EDITION", entityId: edition.id, editionId: edition.id });
        if (sent.ok) emails += 1;
      }
      return { approved, total, notified, emails };
    });
    (step.status === "ran" ? result.ran : result.skipped).push(`DEADLINE_ALERT:${edition.id}`);
  }
}

// ── Step 4: coverage checks ────────────────────────────────────────────────

async function coverageChecks(ctx: { now: Date; triggeredBy: TriggeredBy; result: TickResult }) {
  const { now, triggeredBy, result } = ctx;
  const recentlyClosed = await db
    .select({ campaign: submissionCampaigns, edition: editions })
    .from(submissionCampaigns)
    .innerJoin(editions, eq(editions.id, submissionCampaigns.editionId))
    .where(
      and(
        eq(submissionCampaigns.status, "CLOSED"),
        isNotNull(submissionCampaigns.closedAt),
        gte(submissionCampaigns.closedAt, addDays(now, -COVERAGE_CHECK_WINDOW_DAYS)),
        lte(submissionCampaigns.closedAt, now),
        inArray(editions.status, ["CLOSED", "PROCESSING", "EDITORIAL_REVIEW"]),
      ),
    );
  for (const { edition } of recentlyClosed) {
    const step = await runStep({ editionId: edition.id, step: "COVERAGE_CHECK", runKey: `${edition.id}:COVERAGE_CHECK`, triggeredBy, scheduledFor: now, now }, async () => {
      const coverage = await coverageByCampus(edition.id);
      const under = coverage.campuses.filter((c) => coverage.balance.underrepresented.includes(c.campusId));
      let notified = 0;
      if (coverage.totals.submissions === 0) {
        notified += await notifyEditors({ type: "LOW_CAMPUS_COVERAGE", title: `No submissions for ${edition.label}`, body: "The campaign closed without any contribution. Consider reopening it or contacting the campus ambassadors.", entityType: "EDITION", entityId: edition.id, href: `/editions/${edition.id}/contributors` });
      }
      for (const c of under) {
        notified += await notifyEditors({
          type: "LOW_CAMPUS_COVERAGE",
          title: `${c.name} is under-represented`,
          body: `Only ${c.submissions} ${c.submissions === 1 ? "submission mentions" : "submissions mention"} the ${c.name} campus (average ${coverage.balance.average}). Consider requesting a contribution from the ${c.name} ambassadors.`,
          entityType: "EDITION",
          entityId: edition.id,
          href: `/editions/${edition.id}/inbox?campus=${c.slug}`,
          campusId: c.campusId,
        });
      }
      let emails = 0;
      if (under.length) {
        const message = lowCoverageEmail({ edition: { label: edition.label, issueNumber: edition.issueNumber }, campuses: under.map((c) => ({ name: c.name, submissions: c.submissions })), average: coverage.balance.average, link: `${env.NEXT_PUBLIC_APP_URL}/editions/${edition.id}/inbox` });
        for (const editor of await listEditors()) {
          const sent = await sendEmail({ to: editor.email, subject: message.subject, layout: message.layout, template: message.template, entityType: "EDITION", entityId: edition.id, editionId: edition.id });
          if (sent.ok) emails += 1;
        }
      }
      return { label: coverage.balance.label, score: coverage.balance.score, underrepresented: under.map((c) => c.slug), notified, emails, submissions: coverage.totals.submissions };
    });
    (step.status === "ran" ? result.ran : result.skipped).push(`COVERAGE_CHECK:${edition.id}`);
  }
}

// ── Introspection for the Automations screen ───────────────────────────────

export async function listAutomationRuns(editionId?: string, limit = 100): Promise<AutomationRun[]> {
  return db
    .select()
    .from(automationRuns)
    .where(editionId ? eq(automationRuns.editionId, editionId) : undefined)
    .orderBy(desc(automationRuns.createdAt))
    .limit(limit);
}

export type AutomationDescription = {
  key: AutomationKey;
  label: string;
  description: string;
  enabled: boolean;
  /** When it happens, in words (from the campaign defaults). */
  when: string;
  /** Next occurrence, when it can be computed from the upcoming campaign. */
  nextAt: Date | null;
  nextLabel: string | null;
  /** Edition the next occurrence belongs to. */
  editionId: string | null;
  editionLabel: string | null;
};

const AUTOMATION_META: Record<AutomationKey, { label: string; description: string; when: (d: CampaignDefaults) => string }> = {
  editionCreation: { label: "Create the next edition", description: "Creates the edition, its sections and a scheduled campaign from the defaults.", when: () => `${EDITION_CREATION_WINDOW_DAYS} days before the campaign opens` },
  contributionRequest: { label: "Contribution request", description: "Selects contributors per campus and emails each one a personal link.", when: (d) => `Day ${d.openDay}, ${String(d.openHour).padStart(2, "0")}:00` },
  reminder1: { label: "Reminder #1", description: "Friendly nudge with the number of days left, to those who have not submitted.", when: (d) => `Day ${d.reminder1Day}, ${String(d.openHour).padStart(2, "0")}:00` },
  reminder2: { label: "Reminder #2", description: "Last-day reminder.", when: (d) => `Day ${d.reminder2Day}, ${String(d.openHour).padStart(2, "0")}:00` },
  gracePeriod: { label: "Grace period", description: "Late entries are accepted for one more day; a last call goes out at the deadline.", when: (d) => `Day ${d.reminder2Day}, 23:59 → Day ${d.graceDay}, 23:59` },
  aiProcessing: { label: "AI processing", description: "Normalises, classifies and clusters every submission as soon as the campaign closes.", when: (d) => `Day ${d.graceDay}, 23:59 (after closing)` },
  editorialAlert: { label: "Editorial alert", description: "Tells the editors when processing is finished and what needs attention.", when: () => "When processing finishes" },
  coverageCheck: { label: "Campus coverage check", description: "Flags campuses with fewer than half the average number of submissions.", when: () => "After the campaign closes" },
  deadlineAlert: { label: "Deadline alert", description: "Reminds the editors 24 hours before the final review.", when: (d) => `Day ${d.finalReviewDay - 1}, 18:00` },
};

/** Human-readable automation schedule with the next occurrence per automation. */
export async function describeAutomations(now = new Date()): Promise<{ items: AutomationDescription[]; defaults: CampaignDefaults; toggles: AutomationToggles }> {
  const [toggles, defaults] = await Promise.all([getAutomationToggles(), getCampaignDefaults()]);
  const upcoming = await db
    .select({ campaign: submissionCampaigns, edition: editions })
    .from(submissionCampaigns)
    .innerJoin(editions, eq(editions.id, submissionCampaigns.editionId))
    .where(inArray(submissionCampaigns.status, ["SCHEDULED", "OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD"]))
    .orderBy(asc(submissionCampaigns.opensAt))
    .limit(3);
  const nextEdition = await db.select({ finalReviewAt: editions.finalReviewAt, id: editions.id, label: editions.label }).from(editions).where(and(isNotNull(editions.finalReviewAt), gte(editions.finalReviewAt, now))).orderBy(asc(editions.finalReviewAt)).limit(1);

  const nextFor = (pick: (c: Campaign) => Date): { at: Date; editionId: string; label: string } | null => {
    for (const { campaign, edition } of upcoming) {
      if (campaignPhaseAt(campaign, now) === "CLOSED") continue;
      const at = pick(campaign);
      if (at.getTime() >= now.getTime()) return { at, editionId: edition.id, label: edition.label };
    }
    return null;
  };
  const nextMonth = nextEditionMonth(now);
  const nextSchedule = computeCampaignSchedule({ ...nextMonth, defaults });
  const creationAt = addDays(nextSchedule.opensAt, -EDITION_CREATION_WINDOW_DAYS);

  const nextByKey: Record<AutomationKey, { at: Date; editionId: string | null; label: string | null } | null> = {
    editionCreation: creationAt.getTime() >= now.getTime() ? { at: creationAt, editionId: null, label: editionLabel(nextMonth.month, nextMonth.year) } : null,
    contributionRequest: nextFor((c) => c.opensAt),
    reminder1: nextFor((c) => c.reminder1At),
    reminder2: nextFor((c) => c.reminder2At),
    gracePeriod: nextFor((c) => c.deadlineAt),
    aiProcessing: nextFor((c) => c.graceEndsAt),
    editorialAlert: nextFor((c) => c.graceEndsAt),
    coverageCheck: nextFor((c) => c.graceEndsAt),
    deadlineAlert: nextEdition[0]?.finalReviewAt ? { at: new Date(nextEdition[0].finalReviewAt.getTime() - DEADLINE_ALERT_WINDOW_MS), editionId: nextEdition[0].id, label: nextEdition[0].label } : null,
  };

  const items = AUTOMATION_KEYS.map((key) => {
    const meta = AUTOMATION_META[key];
    const next = nextByKey[key];
    return {
      key,
      label: meta.label,
      description: meta.description,
      enabled: toggles[key],
      when: meta.when(defaults),
      nextAt: next?.at ?? null,
      nextLabel: next ? formatZoned(next.at, { weekday: "short" }) : null,
      editionId: next?.editionId ?? null,
      editionLabel: next?.label ?? null,
    } satisfies AutomationDescription;
  });
  return { items, defaults, toggles };
}

/** Automation runs of an edition keyed by step (for the control room timeline). */
export async function automationRunsByStep(editionId: string) {
  const rows = await listAutomationRuns(editionId, 50);
  const byStep = new Map<string, AutomationRun>();
  for (const row of rows) if (!byStep.has(row.step)) byStep.set(row.step, row);
  return byStep;
}
