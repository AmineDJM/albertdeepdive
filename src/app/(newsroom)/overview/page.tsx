import Link from "next/link";
import { ArrowRight, Inbox, Layers, Mail, Newspaper, Plus, Sparkles } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { homeData, OUTPUT_KIND_LABELS, type HomeEditionCard, type OutputKind } from "@/server/home/service";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { CoverThumbnail } from "@/components/newsroom/cover-thumbnail";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatDate } from "@/lib/utils";
import { PHASES, STATUS_LABELS } from "@/lib/editorial/edition-state";
import { getUi } from "@/server/i18n/locale";
import { experienceOf } from "@/lib/experience";
import { NewEditionButton } from "@/components/newsroom/new-edition-button";
import { NewsletterShelf, NoNewsletters, type Shelf } from "@/components/newsroom/newsletter-shelf";
import { PublicationEditor } from "@/app/(newsroom)/publications/publication-editor";
import { newsletterShelf } from "@/server/outputs/service";

export const dynamic = "force-dynamic";

/**
 * Home.
 *
 * Three questions, in the order a person asks them on arriving: what is happening, what needs me,
 * what can go out next. The answers are the workspace's own numbers, the edition in hand with its
 * gaps and one thing to do, and the editions as the shapes they take — never a dashboard for its
 * own sake.
 */

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function OutputChips({ outputs, published, size = "xs" }: { outputs: OutputKind[]; published?: OutputKind[]; size?: "xs" | "sm" }) {
  if (!outputs.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {outputs.map((kind) => (
        <span key={kind} className={cn("rounded-[5px] border px-1.5 font-medium", size === "xs" ? "py-px text-2xs" : "py-0.5 text-xs", published?.includes(kind) ? "border-success/30 bg-success-soft text-success" : "border-border bg-muted text-muted-foreground")}>
          {OUTPUT_KIND_LABELS[kind]}
        </span>
      ))}
    </span>
  );
}

function EditionCard({ edition, tr }: { edition: HomeEditionCard; tr: (text: string) => string }) {
  return (
    <Link href={`/editions/${edition.id}`} className="lift group flex gap-3 rounded-xl border border-border bg-card p-3">
      <div className="w-[68px] shrink-0">
        <CoverThumbnail url={edition.coverUrl} label={edition.label} issueLabel={edition.issueLabel} headline={edition.coverHeadline} className="shadow-none" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold tracking-tight text-foreground">{edition.label}</p>
          <p className="truncate text-xs text-muted-foreground">{edition.title}</p>
          <p className="mt-1 text-2xs text-muted-foreground">
            {edition.date ? formatDate(edition.date) : tr("No date yet")} · {edition.issueLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EditionStatusBadge status={edition.status} />
          <OutputChips outputs={edition.outputs} published={edition.publishedOutputs} />
        </div>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const [data, shelf] = await Promise.all([homeData(tenant.organizationId), newsletterShelf(tenant.organizationId)]);
  const first = user?.name.split(" ")[0] ?? tr("there");
  // Literal so the dictionary test sees every sentence a person can be shown.
  const nextLabels: Record<string, string> = { collect: tr("Collect contributions"), review: tr("Review what came in"), triage: tr("Sort the submissions"), select: tr("Choose the stories"), draft: tr("Draft the articles"), approve: tr("Approve the articles"), layout: tr("Lay out the pages"), publish: tr("Check and publish"), published: tr("Open the edition") };
  const missingLabels = { submissions: tr("submissions to review"), stories: tr("stories missing information"), articles: tr("articles waiting for review"), pictures: tr("pictures with unclear rights"), facts: tr("disputed facts") };
  const next = data.next;
  const phaseIndex = next ? PHASES.findIndex((p) => p.key === next.phase) : -1;
  const collectHref = next ? `/editions/${next.id}/campaign` : "/editions?new=1";
  const canCreate = hasPermission(user, "edition:create");

  // The dialog is a client component; Home passes it down rather than knowing how it works.
  const newNewsletter = canCreate ? <PublicationEditor trigger={<Button size="sm"><Plus /> {tr("New newsletter")}</Button>} /> : null;

  if (experienceOf(user?.preferences) === "standard") {
    return <StandardHome first={first} next={next} shelf={shelf} contributions={data.pulse.contributions30} canCreate={canCreate} nextLabels={nextLabels} newNewsletter={newNewsletter} tr={tr} />;
  }

  return (
    <>
      <PageHeader title={`${tr(greeting())}, ${first}`} description={next ? tr("{edition} is in progress.", { edition: next.label }) : data.recent.length ? tr("Your organization is ready to publish.") : tr("Let’s make your first edition.")} />
      <PageBody className="space-y-8">
        {/* ── Hero: the sentence and the two things to do ── */}
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="masthead text-[30px] leading-[1.1] font-semibold tracking-tight">{next ? tr("What needs you today.") : tr("Your organization is ready to publish.")}</h2>
            <p className="mt-1.5 max-w-xl text-[13.5px] text-muted-foreground">{tr("Briefly follows what happens, finds what is worth publishing and turns it into every format. You approve.")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={collectHref}>
                <Inbox /> {tr("Collect contributions")}
              </Link>
            </Button>
            {canCreate ? <NewEditionButton /> : null}
            {newNewsletter}
          </div>
        </section>

        {/* ── The shelf: the titles, each with the edition being made ── */}
        <section>
          <SectionTitle action={shelf.length ? <Link href="/publications" className="text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground">{tr("All newsletters")}</Link> : undefined}>
            {tr("Your newsletters")}
          </SectionTitle>
          {shelf.length ? (
            <NewsletterShelf shelf={shelf} canCreate={canCreate} newNewsletter={newNewsletter} tr={tr} />
          ) : canCreate ? (
            <NoNewsletters newNewsletter={newNewsletter} tr={tr} />
          ) : (
            <EmptyState compact title={tr("No newsletters yet")} description={tr("Somebody who can create one will start the first.")} />
          )}
        </section>

        {/* ── Pulse ── */}
        <section>
          <SectionTitle>{tr("Organization pulse")}</SectionTitle>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Pulse label={tr("Contributions, 30 days")} value={data.pulse.contributions30} hint={tr("received from your people")} href="/content/contributions" />
            <Pulse label={tr("Stories ready")} value={data.pulse.storiesReady} hint={tr("complete, nothing missing")} href="/content" />
            <Pulse label={tr("Editions in progress")} value={data.pulse.editionsInProgress} hint={tr("being made right now")} href="/editions" />
            <Pulse
              label={tr("Latest publication")}
              value={data.pulse.latest ? (data.pulse.latest.openRate !== null ? `${Math.round(data.pulse.latest.openRate * 100)}%` : data.pulse.latest.formats.map((f) => OUTPUT_KIND_LABELS[f]).join(" · ") || "—") : "—"}
              hint={data.pulse.latest ? (data.pulse.latest.openRate !== null ? tr("opened · {label}", { label: data.pulse.latest.label }) : data.pulse.latest.label) : tr("nothing published yet")}
              href={data.pulse.latest ? `/editions/${data.pulse.latest.editionId}` : "/analytics"}
            />
          </dl>
        </section>

        {/* ── Next edition ── */}
        <section>
          <SectionTitle>{tr("Next edition")}</SectionTitle>
          {next ? (
            <div className="grid gap-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs md:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex gap-5 p-5">
                <div className="hidden w-[112px] shrink-0 sm:block">
                  <CoverThumbnail url={next.coverUrl} label={next.label} issueLabel={next.issueLabel} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[18px] font-semibold tracking-tight">{next.label}</h3>
                    <EditionStatusBadge status={next.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {next.issueLabel}
                    {next.target ? ` · ${tr("target")} ${formatDate(next.target)}` : ""}
                  </p>
                  <ol className="mt-4 flex items-center gap-1" aria-label={tr("Progress")}>
                    {PHASES.map((phase, index) => (
                      <li key={phase.key} className="flex-1" title={tr(phase.label)}>
                        <span className={cn("block h-1.5 rounded-full", index < phaseIndex ? "bg-brand" : index === phaseIndex ? "bg-brand/50" : "bg-muted")} />
                        <span className={cn("mt-1 block truncate text-2xs", index === phaseIndex ? "font-medium text-foreground" : "text-muted-foreground")}>{tr(phase.label)}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                    <span className="flex items-center gap-2">
                      <span className="label-caps">{tr("Outputs")}</span>
                      {next.outputs.length ? <OutputChips outputs={next.outputs} /> : <span className="text-muted-foreground">{tr("none chosen yet")}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="label-caps">{tr("Phase")}</span>
                      <span className="font-medium">{tr(STATUS_LABELS[next.status])}</span>
                    </span>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button asChild>
                      <Link href={next.next.href}>
                        {nextLabels[next.next.label] ?? tr("Open the edition")} <ArrowRight />
                      </Link>
                    </Button>
                    <Button asChild variant="ghost">
                      <Link href={`/editions/${next.id}`}>{tr("Continue edition")}</Link>
                    </Button>
                  </div>
                </div>
              </div>
              <div className="border-t border-border bg-muted/30 p-5 md:border-t-0 md:border-l">
                <p className="label-caps">{tr("Needs your attention")}</p>
                {next.missing.length ? (
                  <ul className="mt-2 divide-y divide-border/70">
                    {next.missing.map((item) => (
                      <li key={item.key}>
                        <Link href={item.href} className="flex items-center justify-between gap-3 py-2 text-[13px] transition-colors duration-150 hover:text-brand">
                          <span>{missingLabels[item.key]}</span>
                          <span className="tabular rounded-sm bg-warning-soft px-1.5 py-0.5 text-2xs font-semibold text-warning">{item.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[13px] text-muted-foreground">{tr("Nothing is missing. Carry on.")}</p>
                )}
              </div>
            </div>
          ) : (
            <EmptyState icon={Sparkles} title={tr("No edition in progress")} description={tr("Start one and Briefly prepares it from what your organization has been saying.")} action={canCreate ? <NewEditionButton /> : null} />
          )}
        </section>

        {/* ── Recent editions ── */}
        <section>
          <SectionTitle action={<Link href="/editions" className="text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground">{tr("All editions")}</Link>}>{tr("Recent editions")}</SectionTitle>
          {data.recent.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.recent.slice(0, 6).map((edition) => (
                <EditionCard key={edition.id} edition={edition} tr={tr} />
              ))}
            </div>
          ) : (
            <EmptyState icon={Newspaper} title={tr("Nothing published yet")} description={tr("Your first edition will appear here with the formats it went out in.")} compact />
          )}
        </section>

        {/* ── Where to go ── */}
        <section className="grid gap-3 sm:grid-cols-3">
          <Shortcut href="/content" icon={Layers} title={tr("Content")} body={tr("Everything your organization has to say, sorted into stories.")} />
          <Shortcut href="/library" icon={Sparkles} title={tr("Library")} body={tr("Your visual memory: photographs, logos, everything Briefly can draw on.")} />
          <Shortcut href="/subscribers" icon={Mail} title={tr("Audience")} body={tr("Who reads you, and who writes for you.")} />
        </section>
      </PageBody>
    </>
  );
}

function Pulse({ label, value, hint, href }: { label: string; value: React.ReactNode; hint: string; href: string }) {
  return (
    <Link href={href} className="lift block rounded-xl border border-border bg-card px-4 py-3.5">
      <dt className="label-caps">{label}</dt>
      <dd className="mt-2 tabular text-[24px] leading-none font-semibold tracking-tight">{value}</dd>
      <dd className="mt-1.5 text-xs text-muted-foreground">{hint}</dd>
    </Link>
  );
}

function Shortcut({ href, icon: Icon, title, body }: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <Link href={href} className="lift flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </Link>
  );
}

/**
 * Home, in Standard: the answer to "what should I do now?" and nothing else.
 *
 * One card, one sentence, one button. The edition in hand and how far it is; or, with none, what
 * has come in and the button that turns it into the next edition. Below it the last few editions,
 * for the person who wants to look back. No pulse, no shortcuts: the sidebar is the map.
 */
function StandardHome({ first, next, shelf, contributions, canCreate, nextLabels, newNewsletter, tr }: { first: string; next: Awaited<ReturnType<typeof homeData>>["next"]; shelf: Shelf; contributions: number; canCreate: boolean; nextLabels: Record<string, string>; newNewsletter: React.ReactNode; tr: (text: string, values?: Record<string, string | number>) => string }) {
  const sentence = next
    ? next.stories
      ? next.stories === 1
        ? tr("{edition} · 1 story ready", { edition: next.label })
        : tr("{edition} · {count} stories ready", { edition: next.label, count: next.stories })
      : next.updates
        ? next.updates === 1
          ? tr("{edition} · 1 update received", { edition: next.label })
          : tr("{edition} · {count} updates received", { edition: next.label, count: next.updates })
        : tr("{edition} · waiting for news", { edition: next.label })
    : contributions
      ? contributions === 1
        ? tr("1 new update received")
        : tr("{count} new updates received", { count: contributions })
      : shelf.length
        ? tr("Nothing in progress")
        : tr("Let’s make your first newsletter.");
  const body = next
    ? tr("Briefly keeps it up to date with everything that comes in. Open it to see what it chose, change what you like, and publish when you are happy.")
    : contributions
      ? tr("Briefly has been listening. One click turns what came in into your next edition.")
      : tr("Give Briefly what happened. Briefly makes it beautiful. You publish it.");
  return (
    <>
      <PageHeader title={`${tr(greeting())}, ${first}`} description={tr("What should I do now?")} />
      <PageBody className="mx-auto w-full max-w-3xl space-y-8">
        <section className="fade-in rounded-2xl border border-border bg-card p-6 shadow-xs" data-testid="home-now">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="masthead text-[24px] leading-tight font-semibold tracking-tight">{sentence}</h2>
            {next ? <EditionStatusBadge status={next.status} /> : null}
          </div>
          <p className="mt-2 max-w-xl text-[13.5px] text-muted-foreground">{body}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {next ? (
              <>
                <Button asChild size="lg">
                  <Link href={`/editions/${next.id}`}>
                    {tr("Continue edition")} <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href={next.next.href}>{nextLabels[next.next.label] ?? tr("Open the edition")}</Link>
                </Button>
              </>
            ) : canCreate && shelf.length ? (
              <NewEditionButton size="lg" label={tr("Prepare my next edition")} />
            ) : canCreate ? (
              newNewsletter
            ) : (
              <Button asChild variant="outline">
                <Link href="/editions">{tr("See the editions")}</Link>
              </Button>
            )}
          </div>
          {next?.missing.length ? (
            <ul className="mt-5 flex flex-wrap gap-2 border-t border-border/70 pt-4" aria-label={tr("Needs your attention")}>
              {next.missing.slice(0, 3).map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="inline-flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-xs font-medium text-warning transition-colors duration-150 hover:border-warning/60">
                    <span className="tabular">{item.count}</span> {({ submissions: tr("updates to look at"), stories: tr("stories missing something"), articles: tr("articles waiting for your approval"), pictures: tr("pictures with unclear rights"), facts: tr("facts that disagree") })[item.key]}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/*
          * The shelf.
          *
          * Not "recent editions": a person has newsletters, and each one is a shelf its editions
          * sit on. Leading with the titles is what makes "start the next one" the obvious move
          * rather than a button somebody has to go looking for.
          */}
        <section>
          <SectionTitle action={shelf.length ? <Link href="/publications" className="text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground">{tr("All newsletters")}</Link> : undefined}>
            {tr("Your newsletters")}
          </SectionTitle>
          {shelf.length ? (
            <NewsletterShelf shelf={shelf} canCreate={canCreate} newNewsletter={newNewsletter} tr={tr} />
          ) : canCreate ? (
            <NoNewsletters newNewsletter={newNewsletter} tr={tr} />
          ) : (
            <EmptyState compact title={tr("No newsletters yet")} description={tr("Somebody who can create one will start the first.")} />
          )}
        </section>
      </PageBody>
    </>
  );
}
