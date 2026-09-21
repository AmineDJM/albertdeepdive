import Link from "next/link";
import { Download, ExternalLink, Shapes } from "lucide-react";
import { editionDashboard, type EditionDashboard } from "@/server/editions/service";
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
import { GuidedNext } from "@/components/newsroom/guided-next";
import { DeleteEdition } from "@/components/newsroom/delete-edition";
import { formatDate } from "@/lib/utils";
import { activeIdentity } from "@/server/design/identity";
import { editionHasContent } from "@/server/publication/readiness";
import { calendarDaysUntil } from "@/lib/campaigns/schedule";
import { intlLocale } from "@/lib/i18n";
import { currentLocale, getUi } from "@/server/i18n/locale";

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
  const locale = intlLocale(await currentLocale());
  const at = (date: Date | string | null | undefined) => formatDate(date, undefined, locale);
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const [d, outputs, brand, sender, stats] = await Promise.all([editionDashboard(editionId), outputMatrix(editionId), activeBrand(tenant.organizationId), senderFor(tenant.organizationId).catch(() => null), publicationStats(tenant.organizationId)]);
  const publication = d.edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, d.edition.publicationId), columns: { id: true, name: true, language: true } }) : null;
  // What every edition of this title is poured into, and where to change it.
  const identity = publication ? await activeIdentity(publication.id) : null;
  const model = identity?.source ? { ...identity.source, rubrics: identity.rubrics.map((rubric) => rubric.name) } : null;
  const coverUrl = d.edition.coverMediaAssetId ? await mediaUrl(d.edition.coverMediaAssetId, "WEB") : null;
  const ed = `/editions/${editionId}`;
  const canEdit = hasPermission(user, "edition:edit");
  const canSetUp = hasPermission(user, "settings:manage") || tenant.role === "OWNER" || tenant.role === "ADMIN";
  const canDelete = hasPermission(user, "edition:archive");
  const published = d.edition.status === "PUBLISHED" || d.edition.status === "ARCHIVED";
  /*
   * Whether there is a newsletter here to look at.
   *
   * Preview, PDF, Word and the web page were offered from the day the issue was created, and for
   * most of an issue's life they produce a cover with nothing behind it — a real file, correctly
   * made, containing no newsletter. That is the worst kind of empty state, because it reads as the
   * product's best effort rather than as "not yet". The controls only appear once a piece has been
   * written; until then the question somebody actually has is what it will look like, and that is
   * the models.
   */
  const hasContent = await editionHasContent(editionId);
  const attention = needsALook(d);
  const attentionLabels = { submissions: tr("updates to look at"), stories: tr("stories missing something"), articles: tr("articles waiting for your approval"), pictures: tr("pictures with unclear rights"), facts: tr("facts that disagree") };
  const languageNames: Record<string, string> = { en: tr("English"), fr: tr("French") };
  const language = publication?.language ?? tenant.locale;
  const subscribers = publication ? (stats.subCounts.get(publication.id) ?? 0) : [...stats.subCounts.values()].reduce((a, b) => a + b, 0);
  const choices: OutputChoice[] = outputs.map(({ format, label, output }) => ({ format, label, enabled: !!output, locked: output?.status === "PUBLISHED", publicUrl: format === "WEB" && output?.publicSlug ? `/r/${output.publicSlug}` : null }));
  const emailOn = choices.some((c) => c.format === "EMAIL" && c.enabled);
  const asked = d.requests.invited;
  /*
   * A little more management, and not a control room.
   *
   * The list answered "what did Briefly decide" and stopped there, which is the right question
   * once and the wrong one every day after: the person running an edition wants to know how long
   * they have, whether the invitation has actually gone, and how many people have written back.
   * So three of these rows carry a number they did not: days left, the last day, and the share who
   * have answered. Nothing new to click, no chart, and no second opinion about anything — each
   * number sits on the decision it is about, which is the only place it means anything.
   */
  const daysToPublish = d.edition.publicationTargetAt ? calendarDaysUntil(d.edition.publicationTargetAt) : null;
  const inDays = (days: number | null) =>
    days === null ? null : days > 1 ? tr("in {count} days", { count: days }) : days === 1 ? tr("tomorrow") : days === 0 ? tr("today") : tr("{count} days ago", { count: Math.abs(days) });
  const publishHint = published ? null : [inDays(daysToPublish), at(d.edition.finalReviewAt) !== "—" ? tr("last check {date}", { date: at(d.edition.finalReviewAt) }) : null].filter(Boolean).join(" · ") || null;
  const deadlineDays = d.campaign ? calendarDaysUntil(d.campaign.deadlineAt) : null;
  const answered = d.requests.submitted;
  const responseRate = asked ? Math.round((answered / asked) * 100) : 0;
  const tone = ((brand?.system as { voice?: { tone?: string[] } } | null)?.voice?.tone ?? []).map((word) => toneLabel(word, tr)).join(", ");
  const webUrl = choices.find((c) => c.format === "WEB")?.publicUrl ?? null;
  const summary = published
    ? tr("Went out on {date}.", { date: at(d.edition.publishedAt ?? d.edition.publicationTargetAt) })
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
            {hasContent ? (
              <>
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
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2" data-testid="nothing-to-preview">
                <Button asChild variant="outline">
                  <Link href={`${ed}/models`}>
                    <Shapes /> {tr("See what it will look like")}
                  </Link>
                </Button>
                <p className="text-2xs text-muted-foreground">{tr("Nothing written yet — there is no newsletter to preview.")}</p>
              </div>
            )}
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
          <Decision label={tr("Publish date")} value={at(d.edition.publicationTargetAt)} hint={publishHint}>
            {canEdit ? <PublishDateChange editionId={editionId} current={d.edition.publicationTargetAt} locked={published} /> : null}
          </Decision>
          <Decision label={tr("Outputs")} value={<OutputsChange editionId={editionId} outputs={choices} canEdit={canEdit && !published} />} />
          {/*
            * The model this edition is made on, which belongs to the title rather than the month.
            *
            * It is on this list because this list is where somebody looks to find out what Briefly
            * decided, and "what does it look like" is the decision they are least able to guess.
            */}
          {publication ? (
            <Decision
              label={tr("Model")}
              value={
                model?.kind === "uploaded" && model.fileName
                  ? tr("Read from {file}", { file: model.fileName })
                  : model?.kind === "brand"
                    ? tr("Designed from your brand")
                    : model?.kind === "briefly"
                      ? tr("One of Briefly's models")
                      : tr("Briefly's own")
              }
              hint={model?.rubrics.length ? model.rubrics.slice(0, 3).join(" · ") : tr("upload yours, or have one designed")}
              change={canEdit ? { href: `/publications/${publication.id}/blueprint`, label: model ? tr("Change") : tr("Choose") } : null}
            />
          ) : null}
          {/*
            * Who was asked, which is the decision every other one on this list depends on.
            *
            * It sat only inside the campaign screen, so the overview could say "0 stories in"
            * without ever saying that nobody had been asked for any — a count that reads as a
            * failure of the newsroom when it is a setting nobody has touched.
            */}
          <Decision
            label={tr("Contributors")}
            value={asked === 0 ? tr("Nobody asked yet") : asked === 1 ? tr("1 person asked") : tr("{count} people asked", { count: asked })}
            hint={
              asked === 0
                ? d.campaign?.status === "SCHEDULED"
                  ? tr("the invitation goes out on {date}", { date: at(d.campaign.opensAt) })
                  : d.campaign
                    ? tr("the invitation is ready to go")
                    : tr("nobody is collecting news for this issue")
                : answered
                  ? tr("{count} have answered · {percent}%", { count: answered, percent: responseRate })
                  : tr("nobody has answered yet")
            }
            tone={asked === 0 && !published ? "attention" : "default"}
            change={{ href: `${ed}/campaign`, label: canEdit ? (asked === 0 ? tr("Set up") : tr("Change")) : tr("See") }}
          />
          {d.campaign && !published ? (
            <Decision
              label={tr("Last day")}
              value={at(d.campaign.deadlineAt)}
              hint={deadlineDays !== null && deadlineDays < 0 ? tr("closed") : inDays(deadlineDays)}
              tone={deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 2 ? "attention" : "default"}
              change={canEdit ? { href: `${ed}/deadline` } : null}
            />
          ) : null}
          <Decision label={tr("Stories")} value={d.stories.selected === 1 ? tr("1 story in") : tr("{count} stories in", { count: d.stories.selected })} hint={d.stories.candidates ? tr("{count} more to decide on", { count: d.stories.candidates }) : d.submissions.total ? tr("from {count} updates", { count: d.submissions.total }) : null} tone={d.stories.selected === 0 && !published ? "attention" : "default"} change={{ href: `${ed}/topics`, label: canEdit ? tr("Choose") : tr("See") }} />
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

      {/*
        * One button, and it goes forward.
        *
        * What stood here was two: "look at what came in" at the top and "publish" at the bottom,
        * on either side of eight rows each offering "Change" — three competing answers to "and
        * now?" on one screen. An edition already out is the one case with nothing ahead of it, so
        * it gets the one thing left to do with it: read what happened.
        */}
      {published ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <div>
            <p className="text-[13px] font-semibold">{tr("This edition is out.")}</p>
            <p className="text-xs text-muted-foreground">{tr("You can still open it, read the numbers, or start the next one.")}</p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/analytics?editionId=${editionId}`}>{tr("How it did")}</Link>
          </Button>
        </section>
      ) : (
        <GuidedNext editionId={editionId} room="" />
      )}

      {/*
        * The two things left that are not about making this issue: the whole control room, and
        * unmaking it. Quiet, at the bottom, and far from anything anybody presses by habit.
        */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <p className="text-2xs text-muted-foreground">
          <Link href={`${ed}?view=full`} className="hover:text-foreground hover:underline">{tr("See the full control room")}</Link>
        </p>
        {canDelete ? <DeleteEdition editionId={editionId} label={d.edition.label} published={published} /> : null}
      </div>
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
