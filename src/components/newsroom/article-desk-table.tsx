import { AlertTriangle, Star } from "lucide-react";
import type { ArticleDeskRow } from "@/server/editorial/article-list";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "./data-table";
import { ArticleStatusBadge } from "./status-badge";
import { CampusList } from "./campus-chip";
import { enumLabel, relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export function ManualEditMeter({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-2xs text-muted-foreground">—</span>;
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  const tone = pct >= 50 ? "bg-success" : pct >= 20 ? "bg-brand" : "bg-warning";
  return (
    <span className="flex items-center justify-end gap-1.5" title={`${pct}% of the AI draft was rewritten by an editor`}>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular text-2xs text-muted-foreground">{pct}%</span>
    </span>
  );
}

export function WarningCell({ row }: { row: ArticleDeskRow }) {
  const all = [...row.warnings, ...row.storyWarnings];
  const total = all.length + row.openQuestions.length;
  if (!total) return <span className="text-2xs text-muted-foreground">—</span>;
  const worst = all.some((w) => w.severity === "error") || row.openQuestions.some((q) => q.severity === "high");
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-2xs font-medium", worst ? "text-destructive" : "text-warning")}
      title={[...all.map((w) => w.message), ...row.openQuestions.map((q) => `Missing: ${q.label}`)].join("\n")}
    >
      <AlertTriangle className="size-3" />
      {total}
    </span>
  );
}

/** Dense desk view: one row per article of the edition. */
export async function ArticleDeskTable({ rows }: { rows: ArticleDeskRow[] }) {
  const tr = await getUi();
  const columns: Column<ArticleDeskRow>[] = [
    {
      key: "headline",
      header: tr("Headline"),
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {r.story.isCover ? <Star className="size-3 shrink-0 text-warning" aria-label={tr("Cover story")} /> : null}
            <span className="truncate font-medium">{r.headline}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 whitespace-nowrap">
              <CampusList campuses={r.campuses} max={2} />
            </span>
            <span className="truncate text-2xs text-muted-foreground">
              {r.kicker ? <span className="uppercase tracking-[0.06em]">{r.kicker} · </span> : null}
              {r.story.title}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: "section",
      header: tr("Section"),
      width: "158px",
      cell: (r) =>
        r.section ? (
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: r.section.colour ?? "#94a3b8" }} />
            <span className="truncate text-xs">{r.section.name}</span>
          </span>
        ) : (
          <Badge variant="muted">{tr("Unassigned")}</Badge>
        ),
    },
    { key: "status", header: tr("Status"), width: "124px", cell: (r) => <ArticleStatusBadge status={r.status} /> },
    {
      key: "words",
      header: tr("Words"),
      width: "78px",
      align: "right",
      cell: (r) => (
        <span className="tabular" title={`Target length: ${tr(enumLabel(r.story.targetLength))}`}>
          {r.wordCount || "—"}
        </span>
      ),
    },
    { key: "manual", header: tr("By hand"), width: "96px", align: "right", cell: (r) => <ManualEditMeter ratio={r.manualEditRatio} /> },
    { key: "warnings", header: tr("Flags"), width: "62px", align: "center", cell: (r) => <WarningCell row={r} /> },
    {
      key: "assignee",
      header: tr("Assignee"),
      width: "116px",
      cell: (r) => (r.assignee ? <span className="truncate text-xs">{r.assignee.name}</span> : <span className="text-2xs text-muted-foreground">{tr("Unassigned")}</span>),
    },
    {
      key: "edited",
      header: tr("Last edited"),
      width: "126px",
      cell: (r) => (
        <span className="block text-2xs text-muted-foreground">
          {relativeTime(r.lastEditedAt ?? r.updatedAt)}
          {r.lastEditedByName ? <span className="block truncate">{tr("by")}{" "}{r.lastEditedByName}</span> : r.aiDraftedAt && !r.lastEditedAt ? <span className="block">{tr("AI draft")}</span> : null}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      dense
      className="[&_table]:table-fixed"
      rowKey={(r) => r.id}
      onRowHref={(r) => `/articles/${r.id}`}
      empty={{ title: tr("No article matches these filters"), description: tr("Clear a filter, or draft the missing articles from the stories board.") }}
    />
  );
}
