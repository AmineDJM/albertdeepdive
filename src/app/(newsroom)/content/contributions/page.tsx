import Link from "next/link";
import { Suspense } from "react";
import { Inbox, Send } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { contentEditions, listContributions } from "@/server/content/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { CONTENT_TABS } from "@/components/newsroom/nav";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { DataTable } from "@/components/newsroom/data-table";
import { SubmissionStatusBadge } from "@/components/newsroom/status-badge";
import { CampusList } from "@/components/newsroom/campus-chip";
import { Button } from "@/components/ui/button";
import { storyTypeLabel } from "@/lib/constants";
import { cn, relativeTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/** What people sent in, across every edition — and the one button that asks them for more. */
export default async function ContributionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const view = sp.view ?? "needs_review";
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const [{ rows, facets }, editions] = await Promise.all([listContributions(tenant.organizationId, { view, q: sp.q, editionId: sp.editionId }), contentEditions(tenant.organizationId)]);
  const canCollect = hasPermission(user, "campaign:manage");
  const current = editions[0] ?? null;
  const views = [
    { key: "needs_review", label: tr("Needs review") },
    { key: "missing_info", label: tr("Missing information") },
    { key: "accepted", label: tr("Accepted") },
    { key: "rejected", label: tr("Set aside") },
    { key: "all", label: tr("All") },
  ];
  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `/content/contributions${next.toString() ? `?${next}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title={tr("Contributions")}
        description={tr("What your people sent in. Review it here, or in the edition it belongs to.")}
        actions={
          canCollect && current ? (
            <Button asChild size="sm">
              <Link href={`/editions/${current.id}/campaign`}>
                <Send /> {tr("Collect contributions")}
              </Link>
            </Button>
          ) : null
        }
      >
        <HubTabs tabs={CONTENT_TABS} />
      </PageHeader>
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-5 py-2">
        {views.map((v) => (
          <Link key={v.key} href={qs({ view: v.key })} className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150", view === v.key ? "bg-brand-soft text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {v.label} <span className="tabular text-2xs opacity-70">{facets[v.key === "all" ? "total" : v.key] ?? 0}</span>
          </Link>
        ))}
        <div className="ml-auto">
          <Suspense>
            <FilterBar searchPlaceholder={tr("Search contributions…")} filters={[{ key: "editionId", label: tr("Edition"), options: editions.map((e) => ({ value: e.id, label: e.label })), allLabel: tr("Every edition") }]} />
          </Suspense>
        </div>
      </div>
      <PageBody>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          onRowHref={(row) => `/editions/${row.editionId}/inbox?submission=${row.id}`}
          empty={{ icon: Inbox, title: facets.total ? tr("Nothing in this view") : tr("No contributions yet"), description: facets.total ? tr("Try another view.") : tr("Open a campaign and your people receive a link to send their news, photos and dates.") }}
          columns={[
            {
              key: "title",
              header: tr("Contribution"),
              cell: (row) => (
                <span className="flex flex-col">
                  <span className="font-medium">{row.title}</span>
                  {row.description ? <span className="line-clamp-1 text-xs text-muted-foreground">{row.description}</span> : null}
                </span>
              ),
            },
            { key: "who", header: tr("From"), cell: (row) => <span className="text-xs">{row.contributorName}</span> },
            { key: "campus", header: tr("Where"), cell: (row) => (row.campuses.length ? <CampusList campuses={row.campuses} /> : <span className="text-xs text-muted-foreground">{tr("School-wide")}</span>) },
            { key: "type", header: tr("Type"), cell: (row) => <span className="text-xs">{tr(storyTypeLabel(row.storyType))}</span> },
            { key: "edition", header: tr("Edition"), cell: (row) => <span className="text-xs">{row.editionLabel}</span> },
            { key: "media", header: tr("Files"), cell: (row) => <span className="tabular text-xs">{row.mediaCount || "—"}</span>, align: "right" },
            { key: "status", header: tr("Status"), cell: (row) => <SubmissionStatusBadge status={row.status} /> },
            { key: "when", header: tr("When"), cell: (row) => <span className="text-xs text-muted-foreground">{relativeTime(row.submittedAt ?? row.createdAt)}</span> },
          ]}
        />
      </PageBody>
    </>
  );
}
