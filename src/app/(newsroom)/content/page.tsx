import Link from "next/link";
import { Suspense } from "react";
import { Inbox, Layers } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { contentEditions, listContentStories, type ContentState, type ContentStory } from "@/server/content/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { CONTENT_TABS } from "@/components/newsroom/nav";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { CampusList } from "@/components/newsroom/campus-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { STORY_TYPES, storyTypeLabel } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Content: every story the organisation has to tell, in the state that matters.
 *
 * Four words — Ready, Needs review, Missing information, Used — and behind each story the number
 * of places it came from. The machinery that merged four submissions into one story is not on
 * this screen; the story is.
 */

type StateDef = { key: ContentState; label: string; tone: string };

function statesFor(tr: (t: string) => string): StateDef[] {
  return [
    { key: "ready", label: tr("Ready"), tone: "bg-success-soft text-success" },
    { key: "needs_review", label: tr("Needs review"), tone: "bg-warning-soft text-warning" },
    { key: "missing", label: tr("Missing information"), tone: "bg-coral-soft text-coral-deep" },
    { key: "used", label: tr("Used"), tone: "bg-muted text-muted-foreground" },
  ];
}

function StateBadge({ state, states }: { state: ContentState; states: StateDef[] }) {
  const entry = states.find((item) => item.key === state)!;
  return <span className={cn("rounded-[5px] px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.06em]", entry.tone)}>{entry.label}</span>;
}

function StoryRow({ story, tr, states }: { story: ContentStory; tr: (t: string, vars?: Record<string, string | number>) => string; states: StateDef[] }) {
  return (
    <li>
      <Link href={`/stories/${story.id}`} className="lift flex items-start gap-4 rounded-xl border border-border bg-card p-3.5">
        <div className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {story.heroUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={story.heroUrl} alt="" className="size-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold tracking-tight">{story.title}</p>
          {story.summary ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{story.summary}</p> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            {story.sources ? <span>{tr("{count} sources merged", { count: story.sources })}</span> : null}
            <span>{tr(storyTypeLabel(story.storyType))}</span>
            {story.eventDate ? <span>{formatDate(story.eventDate)}</span> : null}
            <span>{story.editionLabel}</span>
            {story.campuses.length ? <CampusList campuses={story.campuses} /> : null}
          </p>
          {story.missing.length ? <p className="mt-1 text-2xs text-coral-deep">{tr("Missing:")} {story.missing.slice(0, 3).join(" · ")}</p> : null}
        </div>
        <StateBadge state={story.state} states={states} />
      </Link>
    </li>
  );
}

export default async function ContentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const [{ rows, facets }, editions] = await Promise.all([listContentStories(tenant.organizationId, { state: sp.state, q: sp.q, editionId: sp.editionId, storyType: sp.storyType }), contentEditions(tenant.organizationId)]);
  const canCollect = hasPermission(user, "campaign:manage");
  const current = editions[0] ?? null;
  const states = statesFor(tr);
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `/content${next.toString() ? `?${next}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title={tr("Content")}
        description={tr("Everything your organization has to say, sorted into stories.")}
        actions={
          canCollect ? (
            <Button asChild variant="outline" size="sm">
              <Link href={current ? `/editions/${current.id}/campaign` : "/editions?new=1"}>
                <Inbox /> {tr("Collect contributions")}
              </Link>
            </Button>
          ) : null
        }
      >
        <HubTabs tabs={CONTENT_TABS} />
      </PageHeader>
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-5 py-2">
        <Link href={qs({ state: undefined })} className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150", !sp.state ? "bg-brand-soft text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
          {tr("All")} <span className="tabular text-2xs opacity-70">{facets.total}</span>
        </Link>
        {states.map((state) => (
          <Link key={state.key} href={qs({ state: state.key })} className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150", sp.state === state.key ? "bg-brand-soft text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {state.label} <span className="tabular text-2xs opacity-70">{facets[state.key]}</span>
          </Link>
        ))}
        <div className="ml-auto">
          <Suspense>
            <FilterBar
              searchPlaceholder={tr("Search stories…")}
              filters={[
                { key: "editionId", label: tr("Edition"), options: editions.map((e) => ({ value: e.id, label: e.label })), allLabel: tr("Every edition") },
                { key: "storyType", label: tr("Type"), options: STORY_TYPES.map((t) => ({ value: t.value, label: tr(t.label) })) },
              ]}
            />
          </Suspense>
        </div>
      </div>
      <PageBody>
        {rows.length ? (
          <ul className="space-y-2">
            {rows.map((story) => (
              <StoryRow key={story.id} story={story} tr={tr} states={states} />
            ))}
          </ul>
        ) : facets.total ? (
          <EmptyState icon={Layers} title={tr("No story in this state")} description={tr("Pick another state, or clear the search.")} compact />
        ) : (
          <EmptyState
            icon={Layers}
            title={tr("Nothing worth publishing yet.")}
            description={tr("Connect a source or ask your organization for updates.")}
            action={
              canCollect ? (
                <Button asChild>
                  <Link href={current ? `/editions/${current.id}/campaign` : "/editions?new=1"}>
                    <Inbox /> {tr("Collect contributions")}
                  </Link>
                </Button>
              ) : null
            }
          />
        )}
      </PageBody>
    </>
  );
}
