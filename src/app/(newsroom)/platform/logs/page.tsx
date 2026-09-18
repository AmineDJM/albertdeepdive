import { Suspense } from "react";
import { Activity, Cpu, Mail, ScrollText, Zap } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { LOG_SOURCES, LOG_SOURCE_LABELS, loggedWorkspaces, readLogs, type LogSource } from "@/server/platform/logs";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatDateTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const ICONS: Record<LogSource, React.ComponentType<{ className?: string }>> = { audit: ScrollText, jobs: Zap, email: Mail, ai: Cpu };
const HUES: Record<LogSource, string> = { audit: "cobalt", jobs: "violet", email: "teal", ai: "amber" };

/**
 * Everything that happened, everywhere, newest first.
 *
 * Four logs on one timeline, because a support question is never "show me the job queue" — it is
 * "what happened to this customer at two o'clock", and the answer usually crosses two of them: a
 * failed model call, then the job that gave up, then the email that never went.
 *
 * Reading, never writing. Nothing on this page has a button.
 */
export default async function PlatformLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Logs")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Reading every customer’s logs is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const sp = await searchParams;
  const source = sp.source && (LOG_SOURCES as readonly string[]).includes(sp.source) ? (sp.source as LogSource) : undefined;
  const sinceDays = Number(sp.days) > 0 ? Number(sp.days) : 7;

  const [entries, workspaces] = await Promise.all([
    readLogs(
      {
        sources: source ? [source] : undefined,
        organizationId: sp.workspace || undefined,
        query: sp.q || undefined,
        onlyFailures: sp.failures === "1",
        sinceDays,
      },
      150,
    ),
    loggedWorkspaces(),
  ]);

  return (
    <>
      <PageHeader title={tr("Logs")} description={tr("Actions, jobs, email and model calls across every workspace, on one timeline.")}>
        <HubTabs tabs={PLATFORM_TABS} />
      </PageHeader>
      <PageBody className="space-y-4">
        <Suspense>
          <FilterBar
            searchPlaceholder={tr("Search an action, a recipient, an error…")}
            filters={[
              { key: "source", label: tr("Source"), options: LOG_SOURCES.map((value) => ({ value, label: LOG_SOURCE_LABELS[value] })) },
              { key: "workspace", label: tr("Workspace"), options: workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })) },
              {
                key: "days",
                label: tr("Window"),
                options: [
                  { value: "1", label: tr("Last 24 hours") },
                  { value: "7", label: tr("Last 7 days") },
                  { value: "30", label: tr("Last 30 days") },
                ],
              },
              { key: "failures", label: tr("Only failures"), options: [{ value: "1", label: tr("Failures only") }] },
            ]}
          />
        </Suspense>

        {entries.length ? (
          <ol className="divide-y divide-border rounded-lg border border-border bg-card">
            {entries.map((entry) => {
              const Icon = ICONS[entry.source];
              return (
                <li key={entry.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <span
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px]"
                    style={
                      entry.failed
                        ? { backgroundColor: "var(--coral-soft)", color: "var(--coral-deep)" }
                        : { backgroundColor: `var(--${HUES[entry.source]}-soft)`, color: `var(--${HUES[entry.source]}-deep)` }
                    }
                  >
                    <Icon className="size-3" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cn("font-mono text-xs", entry.failed ? "font-medium text-coral-deep" : "text-foreground")}>{entry.action}</span>
                      {entry.subject ? <span className="truncate text-xs text-muted-foreground">{entry.subject}</span> : null}
                      <span className="ml-auto shrink-0 tabular text-2xs text-muted-foreground">{formatDateTime(entry.at)}</span>
                    </span>
                    {entry.detail ? <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{entry.detail}</span> : null}
                    <span className="mt-0.5 flex flex-wrap gap-x-2 text-2xs text-muted-foreground">
                      {entry.workspace ? <span>{entry.workspace}</span> : <span>{tr("platform")}</span>}
                      {entry.actor ? <span>· {entry.actor}</span> : null}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState title={tr("Nothing in that window")} description={tr("Widen the window, clear a filter, or enjoy the quiet.")} icon={Activity} />
        )}

        <p className="text-2xs text-muted-foreground">
          {tr("Showing the")}{" "}{entries.length} {" "}{tr("most recent. Logs are kept as long as each workspace’s retention policy allows.")}</p>
      </PageBody>
    </>
  );
}
