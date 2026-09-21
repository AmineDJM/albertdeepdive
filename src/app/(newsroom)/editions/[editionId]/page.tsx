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
import { AutopilotButton } from "@/components/newsroom/autopilot-button";
import { OutputPicker, type OutputRow } from "@/components/newsroom/output-picker";
import { outputMatrix } from "@/server/outputs/service";
import { getTranslations } from "@/server/i18n/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatDateTime, relativeTime, enumLabel } from "@/lib/utils";
import { PHASES, STATUS_LABELS, nextStatuses, phaseForStatus } from "@/lib/editorial/edition-state";
import { getUi } from "@/server/i18n/locale";
import { experienceOf } from "@/lib/experience";
import { DeleteEdition } from "@/components/newsroom/delete-edition";
import { editionHasContent } from "@/server/publication/readiness";
import { StandardOverview } from "./standard-overview";

export const dynamic = "force-dynamic";

export default async function ControlRoomPage({ params, searchParams }: { params: Promise<{ editionId: string }>; searchParams: Promise<{ view?: string }> }) {
  const tr = await getUi();
  const [{ editionId }, sp, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  // Standard reads the edition as decisions; the control room below stays one link away.
  if (experienceOf(user?.preferences) === "standard" && sp.view !== "full") return <StandardOverview editionId={editionId} />;
  const [d, activity, outputs, translate, hasContent] = await Promise.all([editionDashboard(editionId), recentActivity(editionId, 8), outputMatrix(editionId), getTranslations(), editionHasContent(editionId)]);
  const coverUrl = d.edition.coverMediaAssetId ? await mediaUrl(d.edition.coverMediaAssetId, "WEB") : null;
  const ed = `/editions/${editionId}`;
  const phase = phaseForStatus(d.edition.status);
  const phaseIndex = PHASES.findIndex((p) => p.key === phase);
  const phases: PhaseItem[] = [
    { key: "COLLECT", label: tr("Collect"), detail: `${d.submissions.total} submissions · ${d.requests.submitted}/${d.requests.invited} contributors`, href: `${ed}/campaign`, progress: { value: d.requests.submitted, max: d.requests.invited } },
    { key: "ORGANISE", label: tr("Organise"), detail: `${d.clusters.total} clusters · ${d.stories.selected} stories selected`, href: `${ed}/stories`, progress: { value: d.stories.selected, max: Math.max(d.stories.total, 1) } },
    { key: "WRITE", label: tr("Write"), detail: `${d.articles.drafted} / ${d.stories.selected} articles drafted`, href: `${ed}/articles`, progress: { value: d.articles.drafted, max: d.stories.selected } },
    { key: "EDIT", label: tr("Edit"), detail: `${d.articles.approved} / ${d.stories.selected} approved`, href: `${ed}/articles`, progress: { value: d.articles.approved, max: d.stories.selected } },
    { key: "LAYOUT", label: tr("Layout"), detail: `${d.layout.ready} / ${d.layout.pages || d.layout.target} pages ready`, href: `${ed}/layout`, progress: { value: d.layout.ready, max: d.layout.pages || d.layout.target } },
    { key: "QA", label: tr("QA"), detail: d.latestVersion ? `${d.latestVersion.label} · ${tr(enumLabel(d.latestVersion.status))}` : "Not started", href: `${ed}/qa` },
    { key: "PUBLISH", label: tr("Publish"), detail: d.edition.publishedAt ? `Published ${formatDate(d.edition.publishedAt)}` : `Target ${formatDate(d.edition.publicationTargetAt)}`, href: `${ed}/qa` },
  ].map((p, i) => ({ ...p, state: (i < phaseIndex ? "done" : i === phaseIndex ? "active" : "todo") as PhaseItem["state"] }));

  const canTransition = hasPermission(user, "edition:edit");
  const outputRows: OutputRow[] = outputs.map(({ format, label, output }) => ({
    format,
    label,
    description: translate(`outputs.${format.toLowerCase()}Description` as "outputs.emailDescription"),
    enabled: !!output,
    status: output?.status ?? null,
    detail: !output
      ? null
      : output.status === "PUBLISHED"
        ? translate("outputs.published", { date: output.publishedAt ? formatDate(output.publishedAt) : "" }).trim()
        : output.status === "FAILED"
          ? (output.lastError ?? "Failed")
          : format === "EMAIL"
            ? `${output.recipientCount} recipient${output.recipientCount === 1 ? "" : "s"} · ${tr(enumLabel(output.status))}`
            : enumLabel(output.status),
    locked: output?.status === "PUBLISHED",
    publicUrl: format === "WEB" && output?.publicSlug ? `/r/${output.publicSlug}` : null,
  }));
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
                  <div className="label-caps">{tr("Control room")}</div>
                  {/*
                    * The edition's title is this page's title, so it is the h1.
                    *
                    * It was an h2, which left the control room as the one edition tab with no page
                    * title at all — every other tab gets one from its PageHeader. A heading outline
                    * that opens at level two reads, to anything navigating by heading, as a section
                    * of a page that is not there.
                    */}
                  <h1 className="masthead text-[24px] leading-tight font-semibold tracking-tight">{d.edition.title}</h1>
                  <p className="mt-1 text-xs text-muted-foreground">{STATUS_LABELS[d.edition.status]}{" "}{tr("· publication target")}{" "}{formatDate(d.edition.publicationTargetAt)}{" "}{tr("· final review")}{" "}{formatDateTime(d.edition.finalReviewAt)}</p>
                </div>
                {canTransition ? <EditionStatusControls editionId={editionId} current={d.edition.status} options={options} /> : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="label-caps">{tr("Campaign")}</dt>
                  <dd className="mt-0.5 font-medium">{d.campaign ? `${formatDate(d.campaign.opensAt)} → ${formatDate(d.campaign.graceEndsAt)}` : "Not scheduled"}</dd>
                </div>
                <div>
                  <dt className="label-caps">{tr("Response rate")}</dt>
                  <dd className="mt-0.5 font-medium">{d.requests.invited ? `${Math.round(d.requests.responseRate * 100)}% (${d.requests.submitted}/${d.requests.invited})` : "—"}</dd>
                </div>
                <div>
                  <dt className="label-caps">{tr("Pages")}</dt>
                  <dd className="mt-0.5 font-medium">{d.layout.pages || 0}{" "}{tr("planned /")}{" "}{d.edition.targetPageCount}{" "}{tr("target")}</dd>
                </div>
                <div>
                  <dt className="label-caps">{tr("Editor in chief")}</dt>
                  <dd className="mt-0.5 font-medium">{d.edition.editorInChief?.name ?? "—"}</dd>
                </div>
              </dl>
              <div>
                <SectionTitle>{translate("outputs.heading")}</SectionTitle>
                <div className="mt-2">
                  <OutputPicker editionId={editionId} rows={outputRows} canEdit={canTransition} canPublish={hasPermission(user, "edition:publish")} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm"><Link href={`${ed}/inbox`}>{tr("Inbox")}{" "}<ArrowRight /></Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`${ed}/stories`}>{tr("Stories")}</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`${ed}/layout`}>{tr("Flatplan")}</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`${ed}/qa`}>{tr("Quality gates")}</Link></Button>
                {/* Same rule as Standard: an empty issue has no preview and no file worth handing over. */}
                {hasContent ? (
                  <>
                    <Button asChild size="sm" variant="ghost"><a href={`/print/edition/${editionId}`} target="_blank" rel="noreferrer">{tr("Live preview")}{" "}<ExternalLink /></a></Button>
                    <Button asChild size="sm" variant="ghost"><a href={`/print/edition/${editionId}/export?format=pdf`} download>{tr("PDF")}</a></Button>
                    <Button asChild size="sm" variant="ghost"><a href={`/print/edition/${editionId}/export?format=docx`} download>{tr("Word")}</a></Button>
                  </>
                ) : (
                  <Button asChild size="sm" variant="ghost"><Link href={`${ed}/models`}>{tr("See what it will look like")}</Link></Button>
                )}
                {hasPermission(user, "settings:manage") ? <SimulateReturnsButton editionId={editionId} /> : null}
                {hasPermission(user, "edition:publish") && d.edition.status !== "PUBLISHED" && d.edition.status !== "ARCHIVED" ? <AutopilotButton editionId={editionId} /> : null}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 shadow-xs">
          <SectionTitle>{tr("Coverage by campus")}</SectionTitle>
          <ul className="space-y-2.5">
            {d.campuses.map((c) => (
              <li key={c.campusId}>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium"><span className="size-2 rounded-full" style={{ backgroundColor: c.colour ?? "#2BAFE0" }} />{c.name}</span>
                  <span className="tabular text-muted-foreground">{c.submissions}{" "}{tr("subs ·")}{" "}{c.stories}{" "}{tr("stories")}</span>
                </div>
                <ProgressBar value={c.submissions} max={Math.max(1, ...d.campuses.map((x) => x.submissions))} className="mt-1" tone={c.submissions === 0 ? "warning" : "brand"} />
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t pt-3 text-xs">
            <span className="text-muted-foreground">{d.coverage.represented} / {d.coverage.total}{" "}{tr("represented")}</span>
            <Badge variant={d.coverage.label === "Balanced" ? "success" : d.coverage.label === "Uneven" ? "warning" : "destructive"}>{d.coverage.label}</Badge>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>{tr("Workflow")}</SectionTitle>
        <PhaseTimeline phases={phases} />
      </section>

      <StatGrid columns={6}>
        <Stat label={tr("Submissions")} value={d.submissions.total} hint={`${d.submissions.needsReview} to review · ${d.submissions.duplicates} duplicates`} href={`${ed}/inbox`} />
        <Stat label={tr("Clusters")} value={d.clusters.total} hint={`${d.clusters.confirmed} confirmed`} href={`${ed}/stories`} />
        <Stat label={tr("Stories")} value={`${d.stories.selected}`} hint={`${d.stories.candidates} candidates · ${d.stories.rejected} rejected`} href={`${ed}/stories`} />
        <Stat label={tr("Articles")} value={`${d.articles.approved}/${d.stories.selected}`} hint={`${d.articles.ready} ready for review`} href={`${ed}/articles`} />
        <Stat label={tr("Flags")} value={d.flags.total} hint={`${d.flags.disputedFacts} disputed facts · ${d.media.red} blocked media`} tone={d.flags.total ? "warning" : "success"} icon={Flag} href={`${ed}/stories?flag=needs_attention`} />
        <Stat label={tr("AI cost")} value={formatCurrency(d.ai.costCents / 100)} hint={`${d.ai.calls} calls${d.ai.failed ? ` · ${d.ai.failed} failed` : ""}`} icon={Coins} href="/analytics" />
      </StatGrid>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="label-caps">{tr("Automation timeline")}</span>
            <Link href="/automations" className="text-2xs text-brand hover:underline">{tr("Automations")}</Link>
          </div>
          <ul className="divide-y">
            {d.runs.length === 0 ? <li className="px-4 py-6 text-center text-xs text-muted-foreground">{tr("No automation has run for this edition yet.")}</li> : null}
            {d.runs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <GenericStatusBadge status={r.status} />
                <span className="flex-1">{tr(enumLabel(r.step))}</span>
                <span className="text-2xs text-muted-foreground">{r.finishedAt ? formatDateTime(r.finishedAt) : r.scheduledFor ? `scheduled ${formatDateTime(r.scheduledFor)}` : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-border bg-card shadow-xs">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="label-caps">{tr("Recent activity")}</span>
          </div>
          <ul className="divide-y">
            {activity.length === 0 ? <li className="px-4 py-6 text-center text-xs text-muted-foreground">{tr("No activity yet.")}</li> : null}
            {activity.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px]">{tr(enumLabel(a.action.replace(/\./g, " ")))}</p>
                  <p className="text-2xs text-muted-foreground">{a.userName ?? (a.actorType === "AI" ? "AI pipeline" : a.actorType === "SYSTEM" ? "Automation" : "Contributor")}</p>
                </div>
                <span className="shrink-0 text-2xs text-muted-foreground">{relativeTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Unmaking the issue, at the far end of the room from everything that makes it. */}
      {hasPermission(user, "edition:archive") ? (
        <div className="flex justify-end pt-2">
          <DeleteEdition editionId={editionId} label={d.edition.label} published={d.edition.status === "PUBLISHED" || d.edition.status === "ARCHIVED"} />
        </div>
      ) : null}
    </PageBody>
  );
}
