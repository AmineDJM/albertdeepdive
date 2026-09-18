import Link from "next/link";
import { Building2, UserRound } from "lucide-react";
import type { ArchiveStory } from "@/server/archive/service";
import { CampusList } from "@/components/newsroom/campus-chip";
import { StoryStatusBadge } from "@/components/newsroom/status-badge";
import { storyTypeShort } from "@/lib/constants";
import { enumLabel } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

const ROLE_ORDER = ["WINNER", "INTERVIEWEE", "FOUNDER", "AUTHOR", "ORGANISER", "FINALIST", "JURY", "MENTIONED"];

export async function StoryResult({ story }: { story: ArchiveStory }) {
  const tr = await getUi();
  const people = [...story.people].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)).slice(0, 6);
  const orgs = story.organisations.slice(0, 4);
  const published = story.status === "PUBLISHED" || story.editionStatus === "PUBLISHED" || story.editionStatus === "ARCHIVED";
  return (
    <article className="group relative flex gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-muted/30">
      <span className="mt-1 w-1 shrink-0 self-stretch rounded-full" style={{ backgroundColor: story.section?.colour ?? "#9CA3AF" }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          {story.section ? <span className="font-medium text-foreground/80">{story.section.name}</span> : null}
          <span>{storyTypeShort(story.storyType)}</span>
          {story.bdd?.cohortLabel ? <span>· {story.bdd.cohortLabel}</span> : null}
          <CampusList campuses={story.campuses} max={3} />
          {story.isCover ? <span className="rounded-sm bg-brand-soft px-1 text-brand-foreground">{tr("Cover")}</span> : null}
          {!published ? <StoryStatusBadge status={story.status} /> : null}
        </div>
        <h3 className="mt-0.5 font-display text-[15px] leading-snug font-semibold tracking-tight">
          <Link href={`/stories/${story.id}`} className="hover:underline">
            {story.headline}
          </Link>
        </h3>
        {story.standfirst ? <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{story.standfirst}</p> : null}
        {people.length || orgs.length ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {people.map((p) => (
              <Link key={`${p.id}-${p.role}`} href={`/archive?person=${encodeURIComponent(p.name)}`} className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-1.5 py-0.5 text-2xs hover:border-brand/50" title={tr(enumLabel(p.role))}>
                <UserRound className="size-3 text-muted-foreground" />
                {p.name}
                {p.role !== "MENTIONED" ? <span className="text-muted-foreground">· {tr(enumLabel(p.role).toLowerCase())}</span> : null}
              </Link>
            ))}
            {orgs.map((o) => (
              <Link key={`${o.id}-${o.role}`} href={`/archive?organisation=${encodeURIComponent(o.name)}`} className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-1.5 py-0.5 text-2xs hover:border-brand/50" title={`${tr(enumLabel(o.type))} · ${tr(enumLabel(o.role))}`}>
                <Building2 className="size-3 text-muted-foreground" />
                {o.name}
              </Link>
            ))}
            {story.people.length > people.length ? <span className="text-2xs text-muted-foreground">+{story.people.length - people.length}{" "}{tr("more")}</span> : null}
          </div>
        ) : null}
      </div>
      {story.wordCount ? <span className="tabular hidden shrink-0 self-start pt-1 text-2xs text-muted-foreground sm:block">{story.wordCount}{" "}{tr("words")}</span> : null}
    </article>
  );
}
