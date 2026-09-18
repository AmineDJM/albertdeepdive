import { CircleAlert, Info, Layers, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SectionTitle } from "@/components/newsroom/page-header";
import type { Flatplan } from "@/server/publication/flatplan";
import { cn, relativeTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

/** The layout report of the last copyfit pass, and every layout warning of the issue. */
export async function FlatplanReport({ flatplan }: { flatplan: Flatplan }) {
  const tr = await getUi();
  const { report, warnings, stats, measurementError } = flatplan;
  const errors = warnings.filter((w) => w.severity === "error");
  const alerts = warnings.filter((w) => w.severity === "warning");
  const infos = warnings.filter((w) => w.severity === "info");

  return (
    <div className="space-y-3">
      {measurementError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{tr("The copyfit pass could not run")}</AlertTitle>
          <AlertDescription>
            {measurementError}{" "}{tr("The flatplan below shows the planned pages and the estimated fill; continuation pages appear once the pass succeeds.")}</AlertDescription>
        </Alert>
      ) : null}

      {report?.stale ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>{tr("The plan changed after the last copyfit pass")}</AlertTitle>
          <AlertDescription>
            {tr("The measurements below were taken")}{" "}{relativeTime(report.measuredAt)}{tr(". Run the copyfit pass again to refresh the continuation pages and the fill of every page.")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border border-border bg-card px-3.5 py-3">
        <SectionTitle
          action={
            report ? (
              <span className="text-2xs text-muted-foreground">
                {report.engine}{" "}{tr("· measured")}{" "}{relativeTime(report.measuredAt)}
              </span>
            ) : null
          }
        >
          {tr("Layout report")}</SectionTitle>
        {report ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 xl:grid-cols-7">
              <Metric label={tr("Pages")} value={report.pages} hint={`${report.plannedPages} planned`} />
              <Metric label={tr("Continuation")} value={report.continuationPagesAdded} hint={tr("added by the engine")} tone={report.continuationPagesAdded ? "brand" : "muted"} />
              <Metric label={tr("Rounds")} value={report.rounds} hint={tr("measure → flow")} />
              <Metric label={tr("Blocks moved")} value={report.blocksMoved} hint={tr("onto later pages")} />
              <Metric label={tr("Paragraphs split")} value={report.paragraphsSplit} hint={tr("at a sentence")} />
              <Metric label={tr("Copyfit flows")} value={report.copyfitFlows} hint={tr("type shrunk to fit")} tone={report.copyfitFlows ? "warning" : "muted"} />
              <Metric
                label={tr("Average fill")}
                value={`${Math.round(stats.fill * 100)} %`}
                hint={`${stats.words.toLocaleString("en-GB")} words placed`}
                tone={stats.fill >= 0.8 ? "success" : stats.fill >= 0.5 ? "default" : "warning"}
              />
            </dl>
            <p className="mt-2.5 border-t border-border pt-2 text-xs text-muted-foreground">
              {report.ok
                ? "Every text area fits: no overset text, no blank page and no missing image in the print pass."
                : "The pass finished with problems — see the warnings below."}
              {stats.signaturePadding
                ? ` A printed booklet needs a multiple of four pages: ${stats.pages} pages means ${stats.signaturePadding} more page${stats.signaturePadding === 1 ? "" : "s"} (or one fewer story).`
                : ` ${stats.pages} pages is a clean multiple of four for the printer.`}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {tr("The copyfit pass has not run for this plan yet. Use")}{" "}<b>{tr("Run copyfit")}</b>{" "}{tr("to flow the text through the real print templates and see the continuation pages.")}</p>
        )}
      </div>

      <Collapsible defaultOpen={errors.length > 0} className="rounded-lg border border-border bg-card">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-muted/40">
          <span className="flex items-center gap-2">
            <Layers className="size-3.5 text-muted-foreground" />
            <span className="text-[13px] font-semibold">{tr("Warnings")}</span>
            <span className="flex items-center gap-1">
              {errors.length ? <Badge variant="destructive">{errors.length}{" "}{tr("blocking")}</Badge> : null}
              {alerts.length ? <Badge variant="warning">{alerts.length}{" "}{tr("to check")}</Badge> : null}
              {infos.length ? <Badge variant="muted">{infos.length}{" "}{tr("notes")}</Badge> : null}
              {!warnings.length ? <Badge variant="success">{tr("Nothing to report")}</Badge> : null}
            </span>
          </span>
          <span className="text-2xs text-muted-foreground">{tr("Show / hide")}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {warnings.length ? (
            <ul className="max-h-[420px] divide-y divide-border overflow-y-auto border-t border-border">
              {[...errors, ...alerts, ...infos].map((warning, index) => (
                <li key={`${warning.code}-${warning.page ?? "x"}-${index}`} className="flex items-start gap-2.5 px-3.5 py-2">
                  <span className={cn("mt-0.5 shrink-0", warning.severity === "error" ? "text-destructive" : warning.severity === "warning" ? "text-warning" : "text-muted-foreground")}>
                    {warning.severity === "error" ? <CircleAlert className="size-3.5" /> : warning.severity === "warning" ? <TriangleAlert className="size-3.5" /> : <Info className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 text-xs">
                    {warning.message}
                    <span className="ml-1.5 text-2xs text-muted-foreground uppercase">{warning.code.replace(/_/g, " ").toLowerCase()}</span>
                  </span>
                  {warning.page ? (
                    <a href={`#page-${warning.page}`} className="tabular shrink-0 rounded px-1.5 py-0.5 text-2xs text-brand hover:bg-brand-soft">
                      p. {warning.page}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-border px-3.5 py-3 text-xs text-muted-foreground">
              {tr("No overset text, no under-filled page, no article without space and no blocked image on a planned page.")}</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function Metric({ label, value, hint, tone = "default" }: { label: string; value: React.ReactNode; hint: string; tone?: "default" | "brand" | "warning" | "success" | "muted" }) {
  const tones = { default: "text-foreground", brand: "text-brand", warning: "text-warning", success: "text-success", muted: "text-muted-foreground" };
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd>
        <span className={cn("tabular text-[17px] leading-tight font-semibold", tones[tone])}>{value}</span>
        <span className="block text-2xs text-muted-foreground">{hint}</span>
      </dd>
    </div>
  );
}
