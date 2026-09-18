import Link from "next/link";
import { Download, FileText, Hammer } from "lucide-react";
import type { ArchiveEdition } from "@/server/archive/service";
import { CoverThumbnail } from "@/components/newsroom/cover-thumbnail";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { Button } from "@/components/ui/button";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { formatDate } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

function sizeLabel(bytes: number) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Every edition as a cover card; published ones carry their PDF/DOCX downloads. */
export async function EditionStrip({ editions, activeEditionId }: { editions: ArchiveEdition[]; activeEditionId?: string }) {
  const tr = await getUi();
  if (!editions.length) return null;
  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-1 scrollbar-thin">
      <ul className="flex w-max gap-3">
        {editions.map((e) => {
          const published = e.status === "PUBLISHED" || e.status === "ARCHIVED";
          const active = e.id === activeEditionId;
          return (
            <li key={e.id} className={`flex w-[300px] gap-3 rounded-lg border bg-card p-3 shadow-xs ${active ? "border-brand ring-1 ring-brand/40" : "border-border"}`}>
              <Link href={`/archive?editionId=${e.id}`} className="block w-[84px] shrink-0" aria-label={`Filter the archive on ${e.label}`}>
                <CoverThumbnail url={e.coverUrl} label={e.label} issueLabel={e.issueLabel} headline={e.coverHeadline} />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{e.label}</div>
                    <div className="truncate text-2xs text-muted-foreground">{e.issueLabel}</div>
                  </div>
                  <EditionStatusBadge status={e.status as EditionStatus} />
                </div>
                <div className="mt-1.5 text-2xs text-muted-foreground">
                  {e.stories} {e.stories === 1 ? "story" : "stories"}
                  {e.pageCount ? ` · ${e.pageCount} pages` : ""}
                  {published && e.publishedAt ? ` · ${formatDate(e.publishedAt)}` : e.publicationTargetAt ? ` · target ${formatDate(e.publicationTargetAt)}` : ""}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
                  {e.downloads.length ? (
                    e.downloads.map((d) => (
                      <Button key={d.kind} asChild size="xs" variant="outline">
                        <a href={d.url} download={d.fileName} title={`${d.fileName} · ${sizeLabel(d.sizeBytes)}`}>
                          <Download /> {d.kind}
                        </a>
                      </Button>
                    ))
                  ) : published ? (
                    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                      <FileText className="size-3" /> {" "}{tr("No export yet")}</span>
                  ) : (
                    <Button asChild size="xs" variant="ghost" className="-ml-1.5 text-muted-foreground">
                      <Link href={`/editions/${e.id}`}>
                        <Hammer /> {" "}{tr("In production")}</Link>
                    </Button>
                  )}
                  {e.version ? <span className="ml-auto font-mono text-2xs text-muted-foreground">{e.version.label}</span> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
