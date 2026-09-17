import Link from "next/link";
import { ArrowRight, Coins, Flag, ExternalLink } from "lucide-react";
import { editionDashboard, recentActivity } from "@/server/editions/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { mediaUrl } from "@/server/media/urls";
import { PageBody, SectionTitle } from "@/components/newsroom/page-header";
import { Stat, StatGrid, ProgressBar } from "@/components/newsroom/stat";
import { PhaseTimeline, type PhaseItem } from "@/components/newsroom/phase-timeline";
import { CoverThumbnail } from "@/components/newsroom/cover-thumbnail";
import { GenericStatusBadge } from "@/components/newsroom/status-badge";
import { EditionStatusControls } from "@/components/newsroom/edition-status-controls";
import { SimulateReturnsButton } from "@/components/newsroom/simulate-returns-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatDateTime, relativeTime, enumLabel } from "@/lib/utils";
import { PHASES, STATUS_LABELS, nextStatuses, phaseForStatus } from "@/lib/editorial/edition-state";

export const dynamic = "force-dynamic";

export default async function ControlRoomPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const user = await getCurrentUser();
  const [d, activity] = await Promise.all([editionDashboard(editionId), recentActivity(editionId, 8)]);
  const coverUrl = d.edition.coverMediaAssetId ? await mediaUrl(d.edition.coverMediaAssetId, "WEB") : null;
  const ed = `/editions/${editionId}`;
  const phase = phaseForStatus(d.edition.status);
  const phaseIndex = PHASES.findIndex((p) => p.key === phase);
  const phases: PhaseItem[] = [
    { key: "COLLECT", label: "Collect", detail: `${d.submissions.total} submissions · ${d.requests.submitted}/${d.requests.invited} contributors`, href: `${ed}/campaign`, progress: { value: d.requests.submitted, max: d.requests.invited } },
    { key: "ORGANISE", label: "Organise", detail: `${d.clusters.total} clusters · ${d.stories.selected} stories selected`, href: `${ed}/stories`, progress: { value: d.stories.selected, max: Math.max(d.stories.total, 1) } },
    { key: "WRITE", label: "Write", detail: `${d.articles.drafted} / ${d.stories.selected} articles drafted`, href: `${ed}/articles`, progress: { value: d.articles.drafted, max: d.stories.selected } },
    { key: "EDIT", label: "Edit", detail: `${d.articles.approved} / ${d.stories.selected} approved`, href: `${ed}/articles`, progress: { value: d.articles.approved, max: d.stories.selected } },
    { key: "LAYOUT", label: "Layout", detail: `${d.layout.ready} / ${d.layout.pages || d.layout.target} pages ready`, href: `${ed}/layout`, progress: { value: d.layout.ready, max: d.layout.pages || d.layout.target } },
    { key: "QA", label: "QA", detail: d.latestVersion ? `${d.latestVersion.label} · ${enumLabel(d.latestVersion.status)}` : "Not started", href: `${ed}/qa` },
    { key: "PUBLISH", label: "Publish", detail: d.edition.publishedAt ? `Published ${formatDate(d.edition.publishedAt)}` : `Target ${formatDate(d.edition.publicationTargetAt)}`, href: `${ed}/qa` },
  ].map((p, i) => ({ ...p, state: (i < phaseIndex ? "done" : i === phaseIndex ? "active" : "todo") as PhaseItem["state"] }));

  const canTransition = hasPermission(user, "edition:edit");
  const options = nextStatuses(d.edition.status).filter((st) => st !== "PUBLISHED" && st !== "ARCHIVED" || hasPermission(user, st === "PUBLISHED" ? "edition:publish" : "edition:archive"));

  return (
    <PageBody className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <div className="grid md:grid-cols-[132px_minmax(0,1fr)]">
            <div className="border-r border-border bg-muted/40 p-3">
              <CoverThumbnail url={coverUrl} label={d.edition.label} issueLabel={`${d.edition.isSpecialIssue ? "Special issue" : "Issue"} N°${d.edition.issueNumber}`} headline={d.edition.coverHeadline} />
            </div>
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="label-caps">Control room</div>
                  <h2 className="masthead text-[24px] leading-tight font-semibold tracking-tight">{d.edition.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{STATUS_LABELS[d.edition.status]} · publication target {formatDate(d.edition.publicationTargetAt)} · final review {formatDateTime(d.edition.finalReviewAt)}</p>
                </div>
                {canTransition ? <EditionStatusControls editionId={editionId} current={d.edition.status} options={options} /> : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="label-caps">Campaign</dt>
                  <dd className="mt-0.5 font-medium">{d.campaign ? `${formatDate(d.campaign.opensAt)} → ${formatDate(d.campaign.graceEndsAt)}` : "Not scheduled"}</dd>
                </div>
                <div>
                  <dt className="label-caps">Response rate</dt>
                  <dd className="mt-0.5 font-medium">{d.requests.invited ? `${Math.round(d.requests.responseRate * 100)}% (${d.requests.submitted}/${d.requests.invited})` : "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">Pages</dt>
                  <dd className="mt-0.5 font-medium">{d.layout.pages || 0} planned / {d.edition.targetPageCount} target</dd>
                </div>
                <div>
                  <dt className="label-caps">Editor in chief</dt>
                  <dd className="mt-0.5 font-medium">{d.edition.editorInChief?.name ?? "—"}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm"><Link href={`${ed}/inbox`}>Inbox <ArrowRight /></Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`${ed}/stories`}>Stories</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`${ed}/layout`}>Flatplan</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`${ed}/qa`}>Quality gates</Link></Button>
                <Button asChild size="sm" variant="ghost"><a href={`/print/edition/${editionId}`} target="_blank" rel="noreferrer">Live preview <ExternalLink /></a></Button>
                {hasPermission(user, "settings:manage") ? <SimulateReturnsButton editionId={editionId} /> : null}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
          <SectionTitle>Coverage by campus</SectionTitle>
          <ul className="space-y-2.5">
            {d.campuses.map((c) => (
              <li key={c.campusId}>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium"><span className="size-2 rounded-full" style={{ backgroundColor: c.colour ?? "#2BAFE0" }} />{c.name}</span>
                  <span className="tabular text-muted-foreground">{c.submissions} subs · {c.stories} stories</span>
                </div>
                <ProgressBar value={c.submissions} max={Math.max(1, ...d.campuses.map((x) => x.submissions))} className="mt-1" tone={c.submissions === 0 ? "warning" : "brand"} />
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
            <span className="text-muted-foreground">{d.coverage.represented} / {d.coverage.total} represented</span>
            <Badge variant={d.coverage.label === "Balanced" ? "success" : d.coverage.label === "Uneven" ? "warning" : "destructive"}>{d.coverage.label}</Badge>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Workflow</SectionTitle>
        <PhaseTimeline phases={phases} />
      </section>

      <StatGrid columns={6}>
        <Stat label="Submissions" value={d.submissions.total} hint={`${d.submissions.needsReview} to review · ${d.submissions.duplicates} duplicates`} href={`${ed}/inbox`} />
        <Stat label="Clusters" value={d.clusters.total} hint={`${d.clusters.confirmed} confirmed`} href={`${ed}/stories`} />
        <Stat label="Stories" value={`${d.stories.selected}`} hint={`${d.stories.candidates} candidates · ${d.stories.rejected} rejected`} href={`${ed}/stories`} />
        <Stat label="Articles" value={`${d.articles.approved}/${d.stories.selected}`} hint={`${d.articles.ready} ready for review`} href={`${ed}/articles`} />
        <Stat label="Flags" value={d.flags.total} hint={`${d.flags.disputedFacts} disputed facts · ${d.media.red} blocked media`} tone={d.flags.total ? "warning" : "success"} icon={Flag} href={`${ed}/stories?flag=needs_attention`} />
        <Stat label="AI cost" value={formatCurrency(d.ai.costCents / 100)} hint={`${d.ai.calls} calls${d.ai.failed ? ` · ${d.ai.failed} failed` : ""}`} icon={Coins} href="/analytics" />
      </StatGrid>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="label-caps">Automation timeline</span>
            <Link href="/automations" className="text-2xs text-brand hover:underline">Automations</Link>
          </div>
          <ul className="divide-y">
            {d.runs.length === 0 ? <li className="px-4 py-6 text-center text-xs text-muted-foreground">No automation has run for this edition yet.</li> : null}
            {d.runs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <GenericStatusBadge status={r.status} />
                <span className="flex-1">{enumLabel(r.step)}</span>
                <span className="text-2xs text-muted-foreground">{r.finishedAt ? formatDateTime(r.finishedAt) : r.scheduledFor ? `scheduled ${formatDateTime(r.scheduledFor)}` : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="label-caps">Recent activity</span>
          </div>
          <ul className="divide-y">
            {activity.length === 0 ? <li className="px-4 py-6 text-center text-xs text-muted-foreground">No activity yet.</li> : null}
            {activity.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px]">{enumLabel(a.action.replace(/\./g, " "))}</p>
                  <p className="text-2xs text-muted-foreground">{a.userName ?? (a.actorType === "AI" ? "AI pipeline" : a.actorType === "SYSTEM" ? "Automation" : "Contributor")}</p>
                </div>
                <span className="shrink-0 text-2xs text-muted-foreground">{relativeTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </PageBody>
  );
}
