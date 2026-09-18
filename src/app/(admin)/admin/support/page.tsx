import Link from "next/link";
import { Cpu, LifeBuoy, Mail, Zap } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { supportEvents, supportRows } from "@/server/platform/support";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, relativeTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Support: understand a customer's problem before they finish describing it.
 *
 * The organisations most likely to write in come first — failed sends, dead jobs, a card that
 * did not go through — and opening one shows the last thirty days of what went wrong for them,
 * with the sheet, the audit trail and the jobs one click away.
 */
export default async function SupportPage({ searchParams }: { searchParams: Promise<{ organization?: string }> }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <PageHeader title={tr("Support")} />;
  const sp = await searchParams;
  const rows = await supportRows();
  const selected = sp.organization ? (rows.find((row) => row.id === sp.organization) ?? null) : null;
  const events = selected ? await supportEvents(selected.id) : [];
  const troubled = rows.filter((row) => row.trouble > 0).length;
  return (
    <>
      <PageHeader title={tr("Support")} description={troubled ? tr("{count} organizations had something go wrong this week.", { count: troubled }) : tr("Nothing has gone wrong for anyone this week.")} />
      <PageBody className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          dense
          onRowHref={(row) => `/admin/support?organization=${row.id}`}
          empty={{ title: tr("No organizations"), icon: LifeBuoy }}
          columns={[
            {
              key: "name",
              header: tr("Organization"),
              cell: (row) => (
                <span className={cn("flex flex-col", selected?.id === row.id && "text-brand")}>
                  <span className="font-medium">{row.name}</span>
                  <span className="text-2xs text-muted-foreground">
                    {row.planName ?? "Free"} · {row.members} {tr("members")}
                  </span>
                </span>
              ),
            },
            { key: "billing", header: tr("Billing"), cell: (row) => (row.subscriptionStatus ? <Badge variant={row.subscriptionStatus === "PAST_DUE" ? "warning" : row.subscriptionStatus === "ACTIVE" || row.subscriptionStatus === "TRIALING" ? "success" : "muted"}>{row.subscriptionStatus.toLowerCase().replace("_", " ")}</Badge> : <span className="text-2xs text-muted-foreground">—</span>) },
            { key: "jobs", header: tr("Failed jobs"), cell: (row) => <span className={cn("tabular text-xs", row.failedJobs7 && "font-semibold text-destructive")}>{row.failedJobs7 || "—"}</span>, align: "right" },
            { key: "emails", header: tr("Failed emails"), cell: (row) => <span className={cn("tabular text-xs", row.failedEmails7 && "font-semibold text-destructive")}>{row.failedEmails7 || "—"}</span>, align: "right" },
            { key: "ai", header: tr("Model errors"), cell: (row) => <span className={cn("tabular text-xs", row.aiErrors7 && "font-semibold text-warning")}>{row.aiErrors7 || "—"}</span>, align: "right" },
            { key: "queued", header: tr("In queue"), cell: (row) => <span className="tabular text-xs">{row.queuedJobs || "—"}</span>, align: "right" },
            { key: "seen", header: tr("Last activity"), cell: (row) => <span className="text-xs text-muted-foreground">{row.lastActivity ? relativeTime(row.lastActivity) : tr("never")}</span> },
          ]}
        />
        <aside className="space-y-4">
          {selected ? (
            <>
              <div className="rounded-lg border border-border bg-card p-4">
                <SectionTitle>{selected.name}</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/organizations/${selected.id}`}>{tr("Organization sheet")}</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/jobs?organizationId=${selected.id}`}>{tr("Jobs")}</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/audit?workspace=${selected.id}&days=30`}>{tr("Audit log")}</Link>
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card">
                <div className="border-b border-border px-3.5 py-2 text-[13px] font-semibold">{tr("What went wrong, 30 days")}</div>
                {events.length ? (
                  <ul className="divide-y divide-border">
                    {events.map((event) => (
                      <li key={event.id} className="flex items-start gap-3 px-3.5 py-2.5">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-coral-soft text-coral-deep">{event.source === "Email" ? <Mail className="size-3" /> : event.source === "AI" ? <Cpu className="size-3" /> : <Zap className="size-3" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-medium">{event.kind || event.source}</span>
                            <span className="shrink-0 text-2xs text-muted-foreground">{relativeTime(event.at)}</span>
                          </span>
                          <span className="line-clamp-3 block text-xs text-muted-foreground">{event.detail || tr("No message recorded.")}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3.5 py-8 text-center text-xs text-muted-foreground">{tr("Nothing has failed for this organization in the last thirty days.")}</p>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">{tr("Pick an organization to see what went wrong for it.")}</div>
          )}
        </aside>
      </PageBody>
    </>
  );
}
