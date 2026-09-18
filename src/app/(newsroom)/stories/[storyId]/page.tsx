import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowUpRight, ExternalLink, FileQuestion, FileText, Quote as QuoteIcon, Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { storyOverview } from "@/server/editorial/stories";
import { editionSectionsWithCounts, getEdition } from "@/server/editions/service";
import { mediaUrls } from "@/server/media/urls";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { ArticleStatusBadge, RightsBadge, SeverityBadge, StoryStatusBadge } from "@/components/newsroom/status-badge";
import { CampusList } from "@/components/newsroom/campus-chip";
import { StoryActions } from "@/components/newsroom/story-actions";
import { FactList } from "@/components/newsroom/fact-list";
import { InformationRequestDialog } from "@/components/newsroom/information-request-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatDateTime, enumLabel, relativeTime, truncate } from "@/lib/utils";
import { storyTypeLabel } from "@/lib/constants";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function StoryPage({ params }: { params: Promise<{ storyId: string }> }) {
  const tr = await getUi();
  const { storyId } = await params;
  const user = await getCurrentUser();
  const overview = await storyOverview(storyId).catch(() => null);
  if (!overview) notFound();
  const { story, cluster, article, submissions, comments } = overview;
  const [edition, sections] = await Promise.all([getEdition(story.editionId), editionSectionsWithCounts(story.editionId)]);
  const canEdit = hasPermission(user, "story:edit");
  const mediaIds = story.media.map((m) => m.mediaAssetId);
  const thumbs = await mediaUrls(mediaIds, "WEB");
  const openMissing = story.missingInformation.filter((m) => !m.resolved);
  const primaryContributor = submissions[0]?.contributor ?? null;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: edition.label, href: `/editions/${edition.id}` },
          { label: tr("Stories"), href: `/editions/${edition.id}/stories` },
          { label: truncate(story.title, 40) },
        ]}
        title={story.title}
        meta={
          <>
            <StoryStatusBadge status={story.status} />
            <Badge variant="outline">{storyTypeLabel(story.storyType)}</Badge>
            {story.isCover ? <Badge variant="brand">{tr("Cover")}</Badge> : null}
          </>
        }
        description={`${story.section?.name ?? "Unassigned"} · ${submissions.length} source${submissions.length === 1 ? "" : "s"} · ${story.facts.length} facts · ${story.quotes.length} quotes`}
        actions={canEdit ? <StoryActions editionId={edition.id} story={{ id: story.id, status: story.status, sectionId: story.sectionId, isCover: story.isCover, priority: story.priority, targetLength: story.targetLength }} sections={sections} hasArticle={!!article && article.status !== "EMPTY"} articleId={article?.id ?? null} /> : null}
      />

      <PageBody className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {story.warnings.length || openMissing.length ? (
            <section className="rounded-lg border border-warning/40 bg-warning-soft/50 p-3">
              <SectionTitle>{tr("Needs attention")}</SectionTitle>
              <ul className="space-y-1.5">
                {story.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span className="flex-1">{w.message}</span>
                    <SeverityBadge severity={w.severity} />
                  </li>
                ))}
                {openMissing.map((m) => (
                  <li key={m.key} className="flex items-start gap-2 text-xs">
                    <FileQuestion className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span className="flex-1">{m.label}</span>
                    <SeverityBadge severity={m.severity} />
                  </li>
                ))}
              </ul>
              {canEdit && primaryContributor ? (
                <div className="mt-2.5">
                  <InformationRequestDialog
                    storyId={story.id}
                    storyTitle={story.title}
                    contributor={{ id: primaryContributor.id, name: `${primaryContributor.firstName} ${primaryContributor.lastName}` }}
                    items={openMissing.map((m) => ({ key: m.key, label: m.label }))}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          <section>
            <SectionTitle
              action={
                article && article.status !== "EMPTY" ? (
                  <Button size="xs" variant="outline" asChild>
                    <Link href={`/articles/${article.id}`}>
                      {tr("Open the editor")}{" "}<ArrowUpRight />
                    </Link>
                  </Button>
                ) : null
              }
            >
              {tr("Article")}</SectionTitle>
            {article && article.status !== "EMPTY" ? (
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ArticleStatusBadge status={article.status} />
                  <span className="text-2xs text-muted-foreground">
                    {article.wordCount} {" "}{tr("words · revision")}{" "}{article.currentRevision}
                    {article.byline ? ` · Article : ${article.byline}` : ""}
                  </span>
                </div>
                {article.kicker ? <p className="label-caps mt-2 text-brand">{article.kicker}</p> : null}
                <h2 className="font-display mt-1 text-xl leading-tight font-semibold">{article.headline}</h2>
                {article.standfirst ? <p className="font-serif mt-1.5 text-sm text-muted-foreground">{article.standfirst}</p> : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center">
                <FileText className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">{tr("No draft yet. The AI can write one from the fact sheet below; you stay in control of every sentence.")}</p>
              </div>
            )}
          </section>

          <section>
            <SectionTitle>{tr("Fact sheet (")}{story.facts.length})</SectionTitle>
            <FactList storyId={story.id} facts={story.facts.map((f) => ({ id: f.id, statement: f.statement, category: f.category, confidence: f.confidence, status: f.status, sourceSubmissionId: f.sourceSubmissionId, sourceExcerpt: f.sourceExcerpt, notes: f.notes, conflictGroup: f.conflictGroup }))} submissions={submissions.map((s) => ({ id: s.id, title: s.title, contributorName: s.contributor ? `${s.contributor.firstName} ${s.contributor.lastName}` : "Unknown" }))} canEdit={canEdit} />
          </section>

          {story.quotes.length ? (
            <section>
              <SectionTitle>{tr("Quotes (")}{story.quotes.length})</SectionTitle>
              <ul className="space-y-2">
                {story.quotes.map((q) => (
                  <li key={q.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-start gap-2">
                      <QuoteIcon className="mt-0.5 size-3.5 shrink-0 text-brand" />
                      <div className="min-w-0 flex-1">
                        <p className="font-serif text-[13px] italic">{tr("“")}{q.text}{tr("”")}</p>
                        <p className="mt-1 text-2xs text-muted-foreground">
                          {q.speakerName ?? "Unattributed"}
                          {q.speakerRole ? `, ${q.speakerRole}` : ""}
                          {q.sourceSubmissionId ? ` · from ${truncate(submissions.find((s) => s.id === q.sourceSubmissionId)?.title ?? "a submission", 40)}` : ""}
                        </p>
                      </div>
                      {q.isPullQuoteCandidate ? <Badge variant="brand">{tr("Pull quote")}</Badge> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {story.media.length ? (
            <section>
              <SectionTitle>{tr("Media (")}{story.media.length})</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {story.media.map((m) => (
                  <Link key={m.mediaAssetId} href={`/media/${m.mediaAssetId}`} className="group overflow-hidden rounded-md border border-border">
                    {thumbs[m.mediaAssetId] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbs[m.mediaAssetId]} alt={m.asset.caption ?? ""} className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]" />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center bg-muted text-2xs text-muted-foreground">{tr("No preview")}</div>
                    )}
                    <div className="space-y-0.5 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <Badge variant="muted">{m.role}</Badge>
                        <RightsBadge status={m.asset.rightsStatus} showLabel={false} />
                      </div>
                      <p className="line-clamp-2 text-2xs text-muted-foreground">{m.asset.caption ?? m.asset.fileName}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {story.bdd ? (
            <section>
              <SectionTitle>{tr("Business Deep Dive")}</SectionTitle>
              <div className="space-y-2 rounded-lg border border-border bg-card p-4 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{story.bdd.companyName}</span>
                  {story.bdd.cohortLabel ? <Badge variant="outline">{story.bdd.cohortLabel}</Badge> : null}
                  {story.bdd.dateText ? <span className="text-2xs text-muted-foreground">{story.bdd.dateText}</span> : null}
                </div>
                <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,130px)_minmax(0,1fr)]">
                  {(
                    [
                      ["The case", story.bdd.theCase],
                      ["The data", story.bdd.theData],
                      ["The challenge", story.bdd.theChallenge],
                      ["The approach", story.bdd.theApproach],
                      ["The methods", story.bdd.theMethods],
                      ["The solution", story.bdd.theSolution],
                      ["The results", story.bdd.theResults],
                    ] as const
                  )
                    .filter(([, v]) => v)
                    .map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="label-caps">{label}</dt>
                        <dd className="text-xs">{value}</dd>
                      </div>
                    ))}
                  {story.bdd.winningTeam.length ? (
                    <div className="contents">
                      <dt className="label-caps">{tr("Winning team")}</dt>
                      <dd className="text-xs">{story.bdd.winningTeam.map((m) => m.name).join(", ")}</dd>
                    </div>
                  ) : null}
                  {story.bdd.jury.length ? (
                    <div className="contents">
                      <dt className="label-caps">{tr("Jury")}</dt>
                      <dd className="text-xs">{story.bdd.jury.map((j) => j.name).join(", ")}</dd>
                    </div>
                  ) : null}
                  {story.bdd.technologies.length ? (
                    <div className="contents">
                      <dt className="label-caps">{tr("Technologies")}</dt>
                      <dd className="flex flex-wrap gap-1">
                        {story.bdd.technologies.map((t) => (
                          <Badge key={t} variant="secondary">
                            {t}
                          </Badge>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-3">
            <SectionTitle>{tr("Sources (")}{submissions.length})</SectionTitle>
            <ul className="space-y-2">
              {submissions.map((sub, i) => (
                <li key={sub.id}>
                  <Link href={`/editions/${edition.id}/inbox?submission=${sub.id}`} className="block rounded-md border border-border px-2.5 py-2 hover:border-brand/50">
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-xs font-medium">{sub.title}</span>
                      {i === 0 ? <Badge variant="brand">{tr("Primary")}</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {sub.contributor ? `${sub.contributor.firstName} ${sub.contributor.lastName}` : "Unknown"} · {formatDateTime(sub.submittedAt ?? sub.createdAt)}
                    </p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {sub.campuses.map((c) => c.campus.name).join(", ") || "School-wide"} · {sub.mediaAssets.length} {" "}{tr("photo")}{sub.mediaAssets.length === 1 ? "" : "s"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            {cluster ? <p className="mt-2 text-2xs text-muted-foreground">{tr("Cluster:")}{" "}{cluster.title}</p> : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-3">
            <SectionTitle>{tr("Editorial")}</SectionTitle>
            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{tr("Section")}</dt>
                <dd className="font-medium">{story.section?.name ?? "Unassigned"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{tr("Campuses")}</dt>
                <dd>
                  <CampusList campuses={story.campuses.map((c) => c.campus)} max={4} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{tr("Score")}</dt>
                <dd className="tabular font-medium">{story.editorialScore ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{tr("Target length")}</dt>
                <dd className="font-medium">{tr(enumLabel(story.targetLength))}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{tr("Template")}</dt>
                <dd className="font-medium">{story.suggestedTemplate ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{tr("Assigned to")}</dt>
                <dd className="font-medium">{story.assignedTo?.name ?? "—"}</dd>
              </div>
            </dl>
            {story.aiScores && Object.keys(story.aiScores).length ? (
              <>
                <Separator className="my-2.5" />
                <div className="label-caps mb-1">{tr("AI scoring")}</div>
                <ul className="space-y-1">
                  {Object.entries(story.aiScores)
                    .filter(([k]) => k !== "total")
                    .map(([k, v]) => (
                      <li key={k} className="flex items-center gap-2 text-2xs">
                        <span className="w-28 shrink-0 truncate text-muted-foreground">{tr(enumLabel(k.replace(/([A-Z])/g, " $1")))}</span>
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Number(v))}%` }} />
                        </span>
                        <span className="tabular w-6 text-right">{Math.round(Number(v))}</span>
                      </li>
                    ))}
                </ul>
              </>
            ) : null}
          </section>

          {story.people.length || story.organisations.length ? (
            <section className="rounded-lg border border-border bg-card p-3">
              <SectionTitle>{tr("People & organisations")}</SectionTitle>
              {story.people.length ? (
                <div className="mb-2">
                  <div className="label-caps mb-1 flex items-center gap-1">
                    <Users className="size-3" /> {" "}{tr("People")}</div>
                  <ul className="space-y-0.5">
                    {story.people.map((p) => (
                      <li key={`${p.personId}-${p.role}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{p.person.fullName}</span>
                        <Badge variant="muted">{tr(enumLabel(p.role))}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {story.organisations.length ? (
                <div>
                  <div className="label-caps mb-1">{tr("Organisations")}</div>
                  <ul className="space-y-0.5">
                    {story.organisations.map((o) => (
                      <li key={`${o.organisationId}-${o.role}`} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{o.organisation.name}</span>
                        <Badge variant="muted">{tr(enumLabel(o.role))}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {story.informationRequests.length ? (
            <section className="rounded-lg border border-border bg-card p-3">
              <SectionTitle>{tr("Information requests")}</SectionTitle>
              <ul className="space-y-1.5">
                {story.informationRequests.map((r) => (
                  <li key={r.id} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={r.status === "ANSWERED" ? "success" : "info"}>{tr(enumLabel(r.status))}</Badge>
                      <span className="text-2xs text-muted-foreground">{relativeTime(r.answeredAt ?? r.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted-foreground">{r.message}</p>
                    {r.answerText ? <p className="mt-1 rounded bg-success-soft px-2 py-1 text-2xs">{truncate(r.answerText, 160)}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {story.events.length ? (
            <section className="rounded-lg border border-border bg-card p-3">
              <SectionTitle>{tr("Event")}</SectionTitle>
              {story.events.map((e) => (
                <div key={e.id} className="text-xs">
                  <p className="font-medium">{e.title}</p>
                  <p className="text-muted-foreground">
                    {e.dateText ?? "—"} {e.location ? `· ${e.location}` : ""}
                  </p>
                  {e.signupUrl ? (
                    <a href={e.signupUrl} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-brand hover:underline">
                      {tr("Sign-up link")}{" "}<ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {comments.length ? (
            <section className="rounded-lg border border-border bg-card p-3">
              <SectionTitle>{tr("Desk notes")}</SectionTitle>
              <ul className="space-y-1.5">
                {comments.map((c) => (
                  <li key={c.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.user?.name ?? "Someone"}</span>
                      <span className="text-2xs text-muted-foreground">{relativeTime(c.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-muted-foreground">{c.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </PageBody>
    </>
  );
}
