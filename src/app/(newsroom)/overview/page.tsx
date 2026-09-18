import Link from "next/link";
import { ArrowRight, Inbox, Sparkles, FileText, Image as ImageIcon, Flag, Coins, CalendarClock, Users } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { editionDashboard, getCurrentEdition, recentActivity } from "@/server/editions/service";
import { mediaUrl } from "@/server/media/urls";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Stat, StatGrid, ProgressBar } from "@/components/newsroom/stat";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { PhaseTimeline, type PhaseItem } from "@/components/newsroom/phase-timeline";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate, formatDateTime, relativeTime, enumLabel } from "@/lib/utils";
import { STATUS_LABELS, PHASES, phaseForStatus } from "@/lib/editorial/edition-state";
import { CoverThumbnail } from "@/components/newsroom/cover-thumbnail";
import { getUi, ui } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  const current = await getCurrentEdition();
  if (!current) {
    return (
      <>
        <PageHeader title={tr("Overview")} />
        <PageBody>
          <EmptyState icon={Sparkles} title={tr("No edition yet")} description={tr("Create the first edition to start collecting contributions.")} action={<Button asChild><Link href="/editions?new=1">{tr("Create an edition")}</Link></Button>} />
        </PageBody>
      </>
    );
  }
  const [d, activity] = await Promise.all([editionDashboard(current.id), recentActivity(current.id, 10)]);
  const coverUrl = d.edition.coverMediaAssetId ? await mediaUrl(d.edition.coverMediaAssetId, "WEB") : null;
  const phase = phaseForStatus(d.edition.status);
  const phaseIndex = PHASES.findIndex((p) => p.key === phase);
  const ed = `/editions/${d.edition.id}`;
  const phases: PhaseItem[] = PHASES.map((p, i) => {
    const state = i < phaseIndex ? "done" : i === phaseIndex ? "active" : "todo";
    const details: Record<string, { detail: React.ReactNode; progress?: { value: number; max: number }; href: string }> = {
      COLLECT: { detail: `${d.submissions.total} submissions · ${Math.round(d.requests.responseRate * 100)}% response`, href: `${ed}/campaign` },
      ORGANISE: { detail: `${d.clusters.total} clusters · ${d.stories.selected} selected`, href: `${ed}/stories` },
      WRITE: { detail: `${d.articles.drafted} / ${d.stories.selected} drafted`, progress: { value: d.articles.drafted, max: d.stories.selected }, href: `${ed}/articles` },
      EDIT: { detail: `${d.articles.approved} / ${d.stories.selected} approved`, progress: { value: d.articles.approved, max: d.stories.selected }, href: `${ed}/articles?status=READY_FOR_REVIEW` },
      LAYOUT: { detail: `${d.layout.ready} / ${d.layout.pages || d.layout.target} pages ready`, progress: { value: d.layout.ready, max: d.layout.pages || d.layout.target }, href: `${ed}/layout` },
      QA: { detail: d.latestVersion ? `Latest ${d.latestVersion.label} · ${tr(enumLabel(d.latestVersion.status))}` : "Not started", href: `${ed}/qa` },
      PUBLISH: { detail: d.edition.publishedAt ? `Published ${formatDate(d.edition.publishedAt)}` : d.edition.publicationTargetAt ? `Target ${formatDate(d.edition.publicationTargetAt)}` : "Scheduled", href: `${ed}/qa` },
    };
    return { key: p.key, label: p.label, state, ...details[p.key] };
  });
  const nextDeadline = d.edition.status === "FINAL_REVIEW" || d.edition.status === "LAYOUT" || d.edition.status === "EDITORIAL_REVIEW" ? { label: tr("Final editorial review"), at: d.edition.finalReviewAt } : d.campaign && d.edition.status !== "CLOSED" && d.edition.status !== "PROCESSING" ? { label: tr("Submissions close"), at: d.campaign.graceEndsAt } : { label: tr("Publication target"), at: d.edition.publicationTargetAt };

  return (
    <>
      <PageHeader title={`${{ morning: tr("Good morning"), afternoon: tr("Good afternoon"), evening: tr("Good evening") }[greeting()]}, ${user?.name.split(" ")[0] ?? tr("there")}`} description={tr("Here is where the current edition stands.")} />
      <PageBody className="space-y-6">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative overflow-hidden rounded-lg border border-border bg-card shadow-xs">
            <div className="grid md:grid-cols-[168px_minmax(0,1fr)]">
              <div className="border-r border-border bg-muted/40 p-4">
                <CoverThumbnail url={coverUrl} label={d.edition.label} issueLabel={`${d.edition.isSpecialIssue ? "Special issue" : "Issue"} N°${d.edition.issueNumber}`} headline={d.edition.coverHeadline} />
              </div>
              <div className="flex flex-col justify-between gap-4 p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="label-caps">{tr("Current edition")}</span>
                    <EditionStatusBadge status={d.edition.status} />
                    {d.edition.isSpecialIssue ? <Badge variant="outline">{tr("Special issue")}</Badge> : null}
                  </div>
                  <h2 className="masthead mt-1 text-[28px] leading-tight font-semibold tracking-tight">
                    {d.edition.label} <span className="text-muted-foreground">· {d.edition.isSpecialIssue ? "Special issue" : "Issue"} N°{d.edition.issueNumber}</span>
                  </h2>
                  <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{d.edition.coverHeadline ?? d.edition.title}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="label-caps">{tr("Phase")}</dt>
                      <dd className="mt-0.5 font-medium">{STATUS_LABELS[d.edition.status]}</dd>
                    </div>
                    <div>
                      <dt className="label-caps">{tr("Next deadline")}</dt>
                      <dd className="mt-0.5 font-medium">{nextDeadline.at ? `${nextDeadline.label} — ${formatDateTime(nextDeadline.at)}` : "—"}</dd>
                    </div>
                    <div>
                      <dt className="label-caps">{tr("Publication target")}</dt>
                      <dd className="mt-0.5 font-medium">{formatDate(d.edition.publicationTargetAt)}</dd>
                    </div>
                    <div>
                      <dt className="label-caps">{tr("Editor in chief")}</dt>
                      <dd className="mt-0.5 font-medium">{d.edition.editorInChief?.name ?? "—"}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild>
                    <Link href={ed}>
                      {tr("Continue editing")}{" "}{d.edition.label} <ArrowRight />
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href={`${ed}/inbox`}>{tr("View submissions")}</Link>
                  </Button>
                  <Button variant="ghost" asChild>
                    <Link href={`${ed}/qa`}>{tr("Preview publication")}</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
            <SectionTitle>{tr("Campus coverage")}</SectionTitle>
            <ul className="space-y-2.5">
              {d.campuses.map((c) => (
                <li key={c.campusId}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="size-2 rounded-full" style={{ backgroundColor: c.colour ?? "#2BAFE0" }} />
                      {c.name}
                    </span>
                    <span className="tabular text-muted-foreground">
                      {c.submissions} {" "}{tr("submissions ·")}{" "}{c.stories} {" "}{tr("stories")}</span>
                  </div>
                  <ProgressBar value={c.submissions} max={Math.max(1, ...d.campuses.map((x) => x.submissions))} className="mt-1" tone={c.submissions === 0 ? "warning" : "brand"} />
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
              <span className="text-muted-foreground">
                {d.coverage.represented} / {d.coverage.total} {" "}{tr("campuses represented")}</span>
              <Badge variant={d.coverage.label === "Balanced" ? "success" : d.coverage.label === "Uneven" ? "warning" : "destructive"}>{d.coverage.label}</Badge>
            </div>
            {d.coverage.underrepresented.length ? <p className="mt-2 text-2xs text-warning">{tr("Under-represented:")}{" "}{d.coverage.underrepresented.join(", ")}</p> : null}
          </div>
        </section>

        <section>
          <SectionTitle>{tr("Workflow")}</SectionTitle>
          <PhaseTimeline phases={phases} />
        </section>

        <StatGrid columns={6}>
          <Stat label={tr("Contributions")} value={d.submissions.total} hint={`${d.submissions.needsReview} to review`} icon={Inbox} hue="teal" href={`${ed}/inbox`} />
          <Stat label={tr("Story clusters")} value={d.clusters.total} hint={`${d.stories.selected} stories selected`} icon={Sparkles} hue="violet" href={`${ed}/stories`} />
          <Stat label={tr("Article drafts")} value={`${d.articles.drafted} / ${d.stories.selected}`} hint={`${d.articles.approved} approved`} icon={FileText} hue="violet" href={`${ed}/articles`} />
          <Stat label={tr("Media")} value={d.media.total} hint={`${d.media.green} cleared · ${d.media.red} blocked`} icon={ImageIcon} hue="magenta" href={`${ed}/media`} />
          <Stat label={tr("Flags")} value={d.flags.total} hint={tr("requiring review")} hue={d.flags.total ? "coral" : "green"} icon={Flag} href={`${ed}/stories?flag=needs_attention`} />
          <Stat label={tr("AI processing cost")} value={formatCurrency(d.ai.costCents / 100)} hint={`${d.ai.calls} calls · ${Math.round(d.ai.tokens / 1000)}k tokens`} icon={Coins} hue="amber" href="/analytics" />
        </StatGrid>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="rounded-lg border border-border bg-card shadow-xs">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="label-caps">{tr("Needs attention")}</span>
              <Link href={`${ed}/stories?flag=needs_attention`} className="text-2xs text-brand hover:underline">
                {tr("Open stories")}</Link>
            </div>
            <ul className="divide-y">
              <AttentionRow icon={Flag} label={tr("Stories with warnings or missing information")} value={d.flags.storiesNeedingAttention} href={`${ed}/stories?flag=needs_attention`} />
              <AttentionRow icon={FileText} label={tr("Articles waiting for review")} value={d.articles.ready} href={`${ed}/articles?status=READY_FOR_REVIEW`} />
              <AttentionRow icon={Inbox} label={tr("Submissions to triage")} value={d.submissions.needsReview} href={`${ed}/inbox?status=NEEDS_REVIEW`} />
              <AttentionRow icon={ImageIcon} label={tr("Media with unclear rights")} value={d.media.yellow} href={`${ed}/media?rights=YELLOW`} />
              <AttentionRow icon={Users} label={tr("Disputed facts")} value={d.flags.disputedFacts} href={`${ed}/stories?flag=conflicts`} />
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card shadow-xs">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <span className="label-caps">{tr("Recent activity")}</span>
              <CalendarClock className="size-3.5 text-muted-foreground" />
            </div>
            <ul className="divide-y">
              {activity.length === 0 ? <li className="px-4 py-6 text-center text-xs text-muted-foreground">{tr("No activity yet.")}</li> : null}
              {activity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px]">{describeActivity(a.action, a.metadata)}</p>
                    <p className="text-2xs text-muted-foreground">{a.userName ?? (a.actorType === "AI" ? "AI pipeline" : a.actorType === "SYSTEM" ? "Automation" : "Contributor")}</p>
                  </div>
                  <span className="shrink-0 text-2xs text-muted-foreground">{relativeTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </PageBody>
    </>
  );
}

function AttentionRow({ icon: Icon, label, value, href }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; href: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-muted/50">
        <Icon className="size-4 text-muted-foreground" />
        <span className="flex-1">{label}</span>
        <span className={`tabular rounded-sm px-1.5 py-0.5 text-2xs font-semibold ${value ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>{value}</span>
      </Link>
    </li>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

function describeActivity(action: string, metadata: Record<string, unknown>) {
  const tr = ui();
  switch (action) {
    case "edition.create":
      return `Edition created (Issue N°${metadata.issueNumber ?? "?"})`;
    case "edition.transition":
      return `Edition moved from ${tr(enumLabel(String(metadata.from ?? "")))} to ${tr(enumLabel(String(metadata.to ?? "")))}`;
    case "campaign.open":
      return `Campaign opened · ${metadata.invitations ?? 0} invitations sent`;
    case "campaign.close":
      return "Campaign closed";
    case "edition.process":
      return `AI processing finished · ${metadata.clusters ?? 0} clusters`;
    default:
      return enumLabel(action.replace(/\./g, " "));
  }
}
