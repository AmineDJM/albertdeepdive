import Link from "next/link";
import { ArrowRight, Download, ExternalLink, Send } from "lucide-react";
import { editionDashboard, type EditionDashboard } from "@/server/editions/service";
import { nextActionFor } from "@/server/home/service";
import { outputMatrix } from "@/server/outputs/service";
import { activeBrand } from "@/server/brand/service";
import { senderFor } from "@/server/email/sender";
import { publicationStats } from "@/server/outputs/service";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { mediaUrl } from "@/server/media/urls";
import { PageBody, SectionTitle } from "@/components/newsroom/page-header";
import { CoverThumbnail } from "@/components/newsroom/cover-thumbnail";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { Decision, LanguageChange, OutputsChange, PublishDateChange, type OutputChoice } from "@/components/newsroom/decisions";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { phaseForStatus } from "@/lib/editorial/edition-state";
import { getUi } from "@/server/i18n/locale";

/**
 * An edition, in Standard.
 *
 * One sentence on where it stands, one thing to do next, and the short list of decisions that
 * change what goes out — each with what Briefly chose and a "Change". Nothing here is a number for
 * its own sake: a count appears only next to the decision it informs. The full control room is a
 * link away for the day someone wants it.
 */
export async function StandardOverview({ editionId }: { editionId: string }) {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const [d, outputs, brand, sender, stats] = await Promise.all([editionDashboard(editionId), outputMatrix(editionId), activeBrand(tenant.organizationId), senderFor(tenant.organizationId).catch(() => null), publicationStats(tenant.organizationId)]);
  const publication = d.edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, d.edition.publicationId), columns: { id: true, name: true, language: true } }) : null;
  const coverUrl = d.edition.coverMediaAssetId ? await mediaUrl(d.edition.coverMediaAssetId, "WEB") : null;
  const ed = `/editions/${editionId}`;
  const canEdit = hasPermission(user, "edition:edit");
  const canPublish = hasPermission(user, "edition:publish");
  const canSetUp = hasPermission(user, "settings:manage") || tenant.role === "OWNER" || tenant.role === "ADMIN";
  const published = d.edition.status === "PUBLISHED" || d.edition.status === "ARCHIVED";
  const phase = phaseForStatus(d.edition.status);
  const action = nextActionFor(phase, d);
  // Literal so the dictionary test sees every sentence a person can be shown.
  const nextLabels: Record<string, string> = { collect: tr("Ask your people for news"), review: tr("Look at what came in"), triage: tr("Sort what came in"), select: tr("Choose the stories"), draft: tr("Write the articles"), approve: tr("Approve the articles"), layout: tr("Lay out the pages"), publish: tr("Check and publish"), published: tr("Open the edition") };
  const attention = needsALook(d);
  const attentionLabels = { submissions: tr("updates to look at"), stories: tr("stories missing something"), articles: tr("articles waiting for your approval"), pictures: tr("pictures with unclear rights"), facts: tr("facts that disagree") };
  const languageNames: Record<string, string> = { en: tr("English"), fr: tr("French") };
  const language = publication?.language ?? tenant.locale;
  const subscribers = publication ? (stats.subCounts.get(publication.id) ?? 0) : [...stats.subCounts.values()].reduce((a, b) => a + b, 0);
  const choices: OutputChoice[] = outputs.map(({ format, label, output }) => ({ format, label, enabled: !!output, locked: output?.status === "PUBLISHED", publicUrl: format === "WEB" && output?.publicSlug ? `/r/${output.publicSlug}` : null }));
  const emailOn = choices.some((c) => c.format === "EMAIL" && c.enabled);
  const tone = ((brand?.system as { voice?: { tone?: string[] } } | null)?.voice?.tone ?? []).map((word) => toneLabel(word, tr)).join(", ");
  const webUrl = choices.find((c) => c.format === "WEB")?.publicUrl ?? null;
  const summary = published
    ? tr("Went out on {date}.", { date: formatDate(d.edition.publishedAt ?? d.edition.publicationTargetAt) })
    : d.stories.selected
      ? tr("{count} stories in · {waiting} waiting for a decision", { count: d.stories.selected, waiting: d.stories.candidates })
      : d.submissions.total
        ? tr("{count} updates received · nothing chosen yet", { count: d.submissions.total })
        : d.campaign
          ? tr("Briefly is collecting news. Nothing has come in yet.")
          : tr("Nothing collected yet. Ask your people for news.");

  return (
    <PageBody className="mx-auto w-full max-w-3xl space-y-6">
      <section className="fade-in flex gap-5">
        <div className="hidden w-[96px] shrink-0 sm:block">
          <CoverThumbnail url={coverUrl} label={d.edition.label} issueLabel={`${d.edition.isSpecialIssue ? tr("Special issue") : tr("Issue")} N°${d.edition.issueNumber}`} headline={d.edition.coverHeadline} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="masthead text-[24px] leading-tight font-semibold tracking-tight">{d.edition.label}</h1>
            <EditionStatusBadge status={d.edition.status} />
          </div>
          <p className="mt-1 text-[13.5px] text-muted-foreground">{summary}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!published ? (
              <Button asChild>
                <Link href={action.href}>
                  {nextLabels[action.key] ?? tr("Open the edition")} <ArrowRight />
                </Link>
              </Button>
            ) : null}
            <Button asChild variant={published ? "default" : "outline"}>
              <a href={`/print/edition/${editionId}`} target="_blank" rel="noreferrer">
                {tr("Preview")} <ExternalLink />
              </a>
            </Button>
            {/* The two files people ask for while looking at the preview, one click earlier. */}
            <Button asChild variant="ghost" size="sm">
              <a href={`/print/edition/${editionId}/export?format=pdf`} download>
                <Download /> {tr("PDF")}
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={`/print/edition/${editionId}/export?format=docx`} download>
                <Download /> {tr("Word")}
              </a>
            </Button>
            {webUrl ? (
              <Button asChild variant="outline">
                <a href={webUrl} target="_blank" rel="noreferrer">{tr("Open the web page")}</a>
              </Button>
            ) : null}
          </div>
          {attention.length ? (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label={tr("Needs your attention")}>
              {attention.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-xs font-medium text-warning transition-colors duration-150 hover:border-warning/60">
                    <span className="tabular">{item.count}</span> {attentionLabels[item.key]}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section>
        <SectionTitle>{tr("What Briefly decided")}</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-muted-foreground">{tr("Change anything. Everything else, Briefly does from your brand.")}</p>
        <ul className="divide-y divide-border/70 rounded-xl border border-border bg-card shadow-xs">
          <Decision label={tr("Language")} value={languageNames[language] ?? language.toUpperCase()} hint={publication ? publication.name : null} change={!publication && canSetUp ? { href: "/settings/workspace" } : null}>
            {publication && canEdit && !published ? <LanguageChange publicationId={publication.id} current={publication.language} /> : null}
          </Decision>
          <Decision label={tr("Audience")} value={subscribers === 1 ? tr("1 subscriber") : tr("{count} subscribers", { count: subscribers })} hint={subscribers === 0 ? tr("nobody yet — add readers first") : null} tone={subscribers === 0 && emailOn ? "attention" : "default"} change={{ href: "/subscribers" }} />
          <Decision label={tr("Publish date")} value={formatDate(d.edition.publicationTargetAt)} hint={published ? null : formatDate(d.edition.finalReviewAt) !== "—" ? tr("last check {date}", { date: formatDate(d.edition.finalReviewAt) }) : null}>
            {canEdit ? <PublishDateChange editionId={editionId} current={d.edition.publicationTargetAt} locked={published} /> : null}
          </Decision>
          <Decision label={tr("Outputs")} value={<OutputsChange editionId={editionId} outputs={choices} canEdit={canEdit && !published} />} />
          <Decision label={tr("Stories")} value={d.stories.selected === 1 ? tr("1 story in") : tr("{count} stories in", { count: d.stories.selected })} hint={d.stories.candidates ? tr("{count} more to decide on", { count: d.stories.candidates }) : d.submissions.total ? tr("from {count} updates", { count: d.submissions.total }) : null} tone={d.stories.selected === 0 && !published ? "attention" : "default"} change={{ href: `${ed}/stories`, label: canEdit ? tr("Choose") : tr("See") }} />
          <Decision label={tr("Pictures")} value={d.media.total === 1 ? tr("1 picture") : tr("{count} pictures", { count: d.media.total })} hint={d.media.yellow + d.media.red ? tr("{count} need a look", { count: d.media.yellow + d.media.red }) : null} tone={d.media.red ? "attention" : "default"} change={{ href: `${ed}/media` }} />
          <Decision label={tr("Tone")} value={tone || tr("Plain and confident")} hint={tr("from your brand")} change={canSetUp ? { href: "/settings/brand" } : null} />
          {emailOn ? (
            <Decision
              label={tr("Sender")}
              value={sender ? (sender.mode === "domain" ? tr("Ready") : sender.mode === "test" ? tr("Test mode") : tr("Via Briefly")) : tr("Not set up")}
              hint={sender ? `${sender.name} <${sender.address}>` : tr("email cannot go out yet")}
              tone={sender?.mode === "domain" ? "ready" : sender ? "default" : "attention"}
              change={canSetUp ? { href: "/settings/email", label: sender?.mode === "domain" ? tr("Change") : tr("Set up") } : null}
            />
          ) : null}
        </ul>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-[13px] font-semibold">{published ? tr("This edition is out.") : tr("Happy with it?")}</p>
          <p className="text-xs text-muted-foreground">{published ? tr("You can still open it, read the numbers, or start the next one.") : tr("Briefly checks everything before it goes out, and asks only when something needs you.")}</p>
        </div>
        <div className="flex items-center gap-2">
          {!published && canPublish ? (
            <Button asChild>
              <Link href={`${ed}/qa`}>
                <Send /> {tr("Publish")}
              </Link>
            </Button>
          ) : null}
          {published ? (
            <Button asChild variant="outline">
              <Link href={`/analytics?editionId=${editionId}`}>{tr("How it did")}</Link>
            </Button>
          ) : null}
        </div>
      </section>

      <p className="text-center text-2xs text-muted-foreground">
        <Link href={`${ed}?view=full`} className="hover:text-foreground hover:underline">{tr("See the full control room")}</Link>
      </p>
    </PageBody>
  );
}

type AttentionKey = "submissions" | "stories" | "articles" | "pictures" | "facts";

function needsALook(d: EditionDashboard): { key: AttentionKey; count: number; href: string }[] {
  const ed = `/editions/${d.edition.id}`;
  return (
    [
      { key: "submissions", count: d.submissions.needsReview, href: `${ed}/inbox?status=NEEDS_REVIEW` },
      { key: "stories", count: d.flags.storiesNeedingAttention, href: `${ed}/stories?flag=needs_attention` },
      { key: "articles", count: d.articles.ready, href: `${ed}/articles?status=READY_FOR_REVIEW` },
      { key: "pictures", count: d.media.yellow, href: `${ed}/media?rights=YELLOW` },
      { key: "facts", count: d.flags.disputedFacts, href: `${ed}/stories?flag=conflicts` },
    ] as { key: AttentionKey; count: number; href: string }[]
  ).filter((item) => item.count > 0);
}

function toneLabel(word: string, tr: (text: string) => string): string {
  switch (word) {
    case "plain":
      return tr("plain");
    case "warm":
      return tr("warm");
    case "precise":
      return tr("precise");
    case "confident":
      return tr("confident");
    case "playful":
      return tr("playful");
    case "formal":
      return tr("formal");
    default:
      return word;
  }
}
