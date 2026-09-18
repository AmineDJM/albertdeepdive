import Link from "next/link";
import { CalendarClock, Inbox, Megaphone, Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { campaignScreen } from "@/server/campaigns/read";
import { ACTIVE_CAMPAIGN_STATUSES } from "@/server/campaigns/service";
import { env } from "@/server/env";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { PhaseTimeline, type PhaseItem } from "@/components/newsroom/phase-timeline";
import { GenericStatusBadge } from "@/components/newsroom/status-badge";
import { CampaignConfigForm, type CampaignFormInitial } from "@/components/newsroom/campaign-config-form";
import { CampaignControls, CreateCampaignButton } from "@/components/newsroom/campaign-controls";
import { CampaignCoverage } from "@/components/newsroom/campaign-coverage";
import { CampaignInvitations } from "@/components/newsroom/campaign-invitations";
import { CampaignEmailLog } from "@/components/newsroom/campaign-email-log";
import { AddContributorsDialog } from "@/components/newsroom/add-contributors-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NoAccess } from "@/components/settings/no-access";
import { PHASE_LABELS, formatZoned, formatZonedLong, calendarDaysUntil } from "@/lib/campaigns/schedule";
import { enumLabel, formatDateTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const PHASE_ORDER = ["OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD", "CLOSED"] as const;

export default async function CampaignPage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "campaign:manage")) return <NoAccess title={tr("Campaign")} permission="campaign:manage" />;
  const canManage = hasPermission(user, "campaign:manage");

  const screen = await campaignScreen(editionId);
  const { campaign, stats, edition } = screen;
  const ed = `/editions/${editionId}`;

  if (!campaign) {
    return (
      <>
        <PageHeader title={tr("Campaign")} description={`${edition.label} · no contribution campaign yet`} />
        <PageBody>
          <EmptyState
            icon={Megaphone}
            title={tr("No campaign has been scheduled for this edition")}
            description={tr("A campaign invites contributors from the chosen pools, reminds them on Day 4 and Day 7, and closes after the grace period. Build one from the monthly defaults, then adjust its dates and targets.")}
            action={canManage ? <CreateCampaignButton editionId={editionId} /> : null}
          />
        </PageBody>
      </>
    );
  }

  const invited = stats?.invited ?? 0;
  const submitted = stats?.submitted ?? 0;
  const declined = stats?.declined ?? 0;
  const silent = Math.max(0, invited - submitted - declined);
  const phaseIndex = PHASE_ORDER.indexOf(screen.phase as (typeof PHASE_ORDER)[number]);
  const sentSteps = screen.runs.filter((r) => r.status === "SUCCEEDED").map((r) => r.step);
  const emailsSent = screen.emails.filter((e) => e.status !== "FAILED").length;
  const emailsFailed = screen.emails.filter((e) => e.status === "FAILED").length;
  const daysToClose = calendarDaysUntil(campaign.graceEndsAt);
  const earliestExpiry = screen.invitations.length ? new Date(Math.min(...screen.invitations.map((i) => i.tokenExpiresAt.getTime()))) : null;

  const phases: PhaseItem[] = [
    { key: "OPEN", label: tr("Day 1 · Open"), detail: `Invitations — ${formatZoned(campaign.opensAt)}`, progress: { value: invited, max: Math.max(1, invited) } },
    { key: "REMINDER_1", label: tr("Day 4 · Reminder"), detail: `Reminder #1 — ${formatZoned(campaign.reminder1At)}` },
    { key: "REMINDER_2", label: tr("Day 7 · Last day"), detail: `Reminder #2 — ${formatZoned(campaign.reminder2At)}` },
    { key: "GRACE_PERIOD", label: tr("Day 8 · Grace"), detail: `Late entries until ${formatZoned(campaign.graceEndsAt)}` },
    { key: "CLOSED", label: tr("Closed"), detail: campaign.closedAt ? `Closed ${formatZoned(campaign.closedAt)}` : `${screen.submissionsTotal} submissions collected` },
  ].map((p, i) => ({
    ...p,
    state: phaseIndex < 0 ? "todo" : i < phaseIndex ? "done" : i === phaseIndex ? "active" : "todo",
  }));

  const initialValues: CampaignFormInitial = {
    name: campaign.name,
    opensAt: campaign.opensAt.toISOString(),
    reminder1At: campaign.reminder1At.toISOString(),
    reminder2At: campaign.reminder2At.toISOString(),
    deadlineAt: campaign.deadlineAt.toISOString(),
    graceEndsAt: campaign.graceEndsAt.toISOString(),
    targets: { ...(campaign.targets ?? {}) },
    contributorGroupIds: [...campaign.contributorGroupIds],
    introMessage: campaign.introMessage ?? "",
    autoProcess: campaign.autoProcess,
    reinvitePrevious: campaign.reinvitePrevious ?? false,
  };

  return (
    <>
      <PageHeader
        title={tr("Campaign")}
        description={
          screen.nextStep
            ? `${PHASE_LABELS[screen.phase]} · next: ${screen.nextStep.label.toLowerCase()} on ${screen.nextStep.whenLabel}`
            : `${PHASE_LABELS[screen.phase]} · ${campaign.closedAt ? `closed ${formatZoned(campaign.closedAt)}` : formatZonedLong(campaign.graceEndsAt)}`
        }
        meta={
          <Badge
            variant={screen.phase === "CLOSED" ? "muted" : screen.phase === "GRACE_PERIOD" ? "warning" : screen.phase === "SCHEDULED" ? "secondary" : "success"}
            title={`Phase read from the campaign dates · recorded status: ${tr(enumLabel(campaign.status))}`}
          >
            {PHASE_LABELS[screen.phase]}
          </Badge>
        }
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link href="/contributors">
                <Users /> {" "}{tr("Contributors")}</Link>
            </Button>
            {canManage ? (
              <CampaignControls
                editionId={editionId}
                status={campaign.status}
                selectionCount={screen.selection?.totals.selected ?? 0}
                invited={invited}
                silent={silent}
                graceEndsAt={campaign.graceEndsAt.toISOString()}
                sentSteps={sentSteps}
              />
            ) : null}
          </>
        }
      />

      <PageBody className="space-y-6">
        <section>
          <SectionTitle
            action={
              <span className="text-2xs text-muted-foreground">
                {campaign.status === "CLOSED"
                  ? `${screen.submissionsTotal} submissions in the inbox`
                  : daysToClose >= 0
                    ? `${daysToClose} day${daysToClose === 1 ? "" : "s"} until the campaign closes`
                    : "Past the closing date — close the campaign to start processing"}
              </span>
            }
          >
            {tr("Phase")}</SectionTitle>
          <PhaseTimeline phases={phases} />
        </section>

        <StatGrid columns={6}>
          <Stat label={tr("Invited")} value={invited} hint={`${screen.selection?.totals.target ?? 0} targeted · ${screen.selection?.totals.pool ?? 0} in the pools`} icon={Users} />
          <Stat label={tr("Opened")} value={stats?.opened ?? 0} hint={invited ? `${Math.round(((stats?.opened ?? 0) / invited) * 100)}% of invitations` : "No invitation sent"} />
          <Stat label={tr("Submitted")} value={submitted} tone={submitted ? "success" : "muted"} hint={`${Math.round((stats?.responseRate ?? 0) * 100)}% response rate`} />
          <Stat label={tr("Silent")} value={silent} tone={silent ? "warning" : "success"} hint={declined ? `${declined} declined` : "Nobody declined"} />
          <Stat label={tr("Submissions")} value={stats?.submissions ?? 0} hint={tr("Contributions received")} icon={Inbox} href={`${ed}/inbox`} />
          <Stat label={tr("Emails")} value={emailsSent} tone={emailsFailed ? "warning" : "default"} hint={emailsFailed ? `${emailsFailed} failed` : `Provider: ${env.EMAIL_PROVIDER === "resend" ? "Resend" : "dev log"}`} />
        </StatGrid>

        <section>
          <SectionTitle action={<span className="text-2xs text-muted-foreground">{tr("Response rate per campus")}</span>}>{tr("Coverage")}</SectionTitle>
          <CampaignCoverage rows={screen.byCampus} balanceLabel={screen.coverage.balance.label} />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div>
            <SectionTitle>{tr("Schedule")}</SectionTitle>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {screen.schedule.map((line) => (
                <li key={line.key} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="flex items-center gap-2">
                    <CalendarClock className="size-3.5 text-muted-foreground" />
                    {line.label}
                  </span>
                  <span className="tabular text-2xs text-muted-foreground">
                    {tr("Day")}{" "}{line.day} · {formatZoned(line.at, { weekday: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SectionTitle action={<Link href="/automations" className="text-2xs text-brand hover:underline">{tr("Automations")}</Link>}>{tr("Automation steps")}</SectionTitle>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {screen.runs.length === 0 ? <li className="px-3 py-6 text-center text-xs text-muted-foreground">{tr("No automation has run for this campaign yet.")}</li> : null}
              {screen.runs.map((r) => (
                <li key={r.step} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <GenericStatusBadge status={r.status} />
                  <span className="flex-1 truncate">{tr(enumLabel(r.step))}</span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {r.triggeredBy === "MANUAL" ? "by hand · " : ""}
                    {r.finishedAt ? formatDateTime(r.finishedAt) : r.scheduledFor ? `scheduled ${formatDateTime(r.scheduledFor)}` : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <SectionTitle
            action={
              <div className="flex items-center gap-3">
                <span className="hidden text-2xs text-muted-foreground sm:inline">
                  {earliestExpiry ? `Personal links are signed; the first expires ${formatZoned(earliestExpiry)}` : "Personal links are signed and expire a week after the campaign closes"}
                </span>
                {canManage && campaign.status !== "CLOSED" ? (
                  <AddContributorsDialog
                    editionId={editionId}
                    campuses={screen.campuses.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }))}
                    campaignOpen={ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status)}
                  />
                ) : null}
              </div>
            }
          >
            {tr("Invitations")}</SectionTitle>
          <CampaignInvitations
            editionId={editionId}
            canResend={canManage && campaign.status !== "CLOSED"}
            rows={screen.invitations.map((i) => ({
              requestId: i.requestId,
              contributorId: i.contributorId,
              name: i.name,
              email: i.email,
              campusName: i.campusName,
              campusColour: screen.campuses.find((c) => c.id === i.campusId)?.colour ?? null,
              status: i.status,
              sentAt: i.sentAt?.toISOString() ?? null,
              openedAt: i.openedAt?.toISOString() ?? null,
              submittedAt: i.submittedAt?.toISOString() ?? null,
              remindedCount: i.remindedCount,
              lastRemindedAt: i.lastRemindedAt?.toISOString() ?? null,
              submissionsCount: i.submissionsCount,
              tokenExpiresAt: i.tokenExpiresAt.toISOString(),
              tokenExpired: i.tokenExpired,
              link: i.link,
            }))}
          />
        </section>

        <section>
          <SectionTitle action={<span className="text-2xs text-muted-foreground">{campaign.status === "CLOSED" ? "Reopen the campaign to change its dates" : "Saved changes apply to the next automated step"}</span>}>
            {tr("Configure")}</SectionTitle>
          <CampaignConfigForm
            editionId={editionId}
            initial={initialValues}
            canManage={canManage}
            openingLocked={campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED"}
            closed={campaign.status === "CLOSED"}
            campuses={screen.campuses.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, colour: c.colour, contributors: c.contributors }))}
            groups={screen.groups.map((g) => ({ id: g.id, name: g.name, description: g.description, members: g.members }))}
          />
        </section>

        <section>
          <SectionTitle action={<span className="text-2xs text-muted-foreground">{screen.emails.length} {" "}{tr("message")}{screen.emails.length === 1 ? "" : "s"} {" "}{tr("· provider “")}{env.EMAIL_PROVIDER}”</span>}>
            {tr("Email log")}</SectionTitle>
          <CampaignEmailLog
            provider={env.EMAIL_PROVIDER}
            rows={screen.emails.map((e) => ({
              id: e.id,
              to: e.to,
              subject: e.subject,
              template: e.template,
              status: e.status,
              provider: e.provider,
              error: e.error,
              sentAt: e.sentAt,
              createdAt: e.createdAt,
              contributorName: e.contributorName,
            }))}
          />
        </section>
      </PageBody>
    </>
  );
}
