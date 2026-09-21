import Link from "next/link";
import { ArrowRight, Download, FileText, Hammer } from "lucide-react";
import type { ShelfEdition } from "@/server/archive/read-edition";
import { formatBytes } from "@/server/media/constants";
import { CoverThumbnail } from "@/components/newsroom/cover-thumbnail";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { Button } from "@/components/ui/button";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { formatDate, formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

/**
 * One issue of the back catalogue: cover, month, theme, extent, the people credited in it and the
 * files it produced. Published issues carry their PDF and Word downloads; issues still in
 * production say so rather than pretending to a file that does not exist.
 */
export async function ArchiveEditionCard({ edition }: { edition: ShelfEdition }) {
  const tr = await getUi();
  const published = edition.status === "PUBLISHED" || edition.status === "ARCHIVED";
  const theme = edition.tagline ?? edition.coverHeadline;
  return (
    <article className="flex gap-3.5 rounded-lg border border-border bg-card p-3.5 shadow-xs transition-colors hover:border-brand/50">
      <Link href={`/archive/${edition.id}`} className="block w-[92px] shrink-0" aria-label={`Open the ${edition.label} issue`}>
        <CoverThumbnail title={edition.publicationName} url={edition.coverUrl} label={edition.label} issueLabel={edition.issueLabel} headline={edition.coverHeadline} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="label-caps">{edition.issueLabel}</div>
            <h3 className="mt-0.5 truncate font-display text-[15px] leading-tight font-semibold tracking-tight">
              <Link href={`/archive/${edition.id}`} className="hover:underline">
                {edition.label}
              </Link>
            </h3>
          </div>
          <EditionStatusBadge status={edition.status as EditionStatus} />
        </div>
        {theme ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{theme}</p> : <p className="mt-1 text-xs text-muted-foreground italic">{tr("No cover theme set yet.")}</p>}

        <dl className="tabular mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{tr("Pages")}</dt>
            <dd className="font-medium">{edition.pageCount ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{tr("Articles")}</dt>
            <dd className="font-medium">{edition.articles}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{tr("Words")}</dt>
            <dd className="font-medium">{formatNumber(edition.words)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{published && edition.publishedAt ? "Published" : "Target"}</dt>
            <dd className="font-medium">{formatDate(published && edition.publishedAt ? edition.publishedAt : edition.publicationTargetAt)}</dd>
          </div>
        </dl>

        {edition.credited.length ? (
          <div className="mt-2.5">
            <div className="label-caps mb-1">{edition.creditedCount}{" "}{tr("contributor")}{edition.creditedCount === 1 ? "" : "s"}{" "}{tr("credited")}</div>
            <div className="flex flex-wrap items-center gap-1">
              {edition.credited.slice(0, 5).map((c) => (
                <Link key={c.id} href={`/contributors/${c.id}`} className="hover:opacity-80" title={`${c.name} — ${c.articles} article${c.articles === 1 ? "" : "s"}`}>
                  <CampusChip name={c.name} colour={c.campusColour} size="xs" />
                </Link>
              ))}
              {edition.creditedCount > 5 ? <span className="text-2xs text-muted-foreground">+{edition.creditedCount - 5}{" "}{tr("more")}</span> : null}
            </div>
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          {edition.downloads.map((d) => (
            <Button key={d.kind} asChild size="xs" variant="outline">
              <a href={d.url} download={d.fileName} title={`${d.fileName} · ${formatBytes(d.sizeBytes)}`}>
                <Download /> {d.kind}
              </a>
            </Button>
          ))}
          {!edition.downloads.length ? (
            published ? (
              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                <FileText className="size-3" />{" "}{tr("No export rendered")}</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                <Hammer className="size-3" />{" "}{tr("In production")}</span>
            )
          ) : null}
          {edition.version ? <span className="ml-1 font-mono text-2xs text-muted-foreground">{edition.version.label}</span> : null}
          <Button asChild size="xs" variant="ghost" className="ml-auto">
            <Link href={`/archive/${edition.id}`}>
              {tr("Open issue")}{" "}<ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
