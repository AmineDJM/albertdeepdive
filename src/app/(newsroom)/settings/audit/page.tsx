import { Suspense } from "react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { auditFacets, listAudit, listDecisions } from "@/server/settings/read-logs";
import { listEditions } from "@/server/editions/service";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollText } from "lucide-react";
import { enumLabel, formatDateTime, relativeTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tx = await getUi();
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "audit:view")) return <NoAccess title={tx("Audit trail")} permission="audit:view" />;

  const [rows, facets, decisions, editions] = await Promise.all([
    listAudit({ action: sp.action, entityType: sp.entityType, userId: sp.userId, editionId: sp.editionId, q: sp.q }),
    auditFacets(),
    listDecisions({ editionId: sp.editionId }),
    listEditions(),
  ]);

  return (
    <>
      <PageHeader
        title={tx("Audit trail")}
        description={tx("Every action the newsroom recorded, and every decision an editor had to justify. Written server-side; nothing here can be edited.")}
      />
      <PageBody className="space-y-5">
        <StatGrid columns={3}>
          <Stat label={tx("Recorded actions")} value={facets.total} hint={tx("Since the database was created")} />
          <Stat label={tx("Justified decisions")} value={decisions.length} hint={tx("Conflicts resolved, gates overridden, revisions restored")} tone="brand" />
          <Stat label={tx("People")} value={facets.people.length} hint={tx("Accounts that have acted")} />
        </StatGrid>

        <Suspense>
          <FilterBar
            searchPlaceholder={tx("Search actions…")}
            filters={[
              { key: "action", label: tx("Action"), options: facets.actions.map((a) => ({ value: a, label: a })) },
              { key: "entityType", label: tx("Entity"), options: facets.entityTypes.map((e) => ({ value: e, label: enumLabel(e) })) },
              { key: "userId", label: tx("Who"), options: facets.people.map((p) => ({ value: p.id, label: p.name })) },
              { key: "editionId", label: tx("Edition"), options: editions.map((e) => ({ value: e.id, label: e.label })) },
            ]}
          />
        </Suspense>

        <section>
          <SectionTitle>{tx("Decisions and their reasons")}</SectionTitle>
          {decisions.length ? (
            <ul className="space-y-1.5">
              {decisions.map((d) => (
                <li key={d.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="brand">{tx(enumLabel(d.decision))}</Badge>
                    <Badge variant="outline">{tx(enumLabel(d.entityType))}</Badge>
                    {d.editionLabel ? <span className="text-2xs text-muted-foreground">{d.editionLabel}</span> : null}
                    <span className="ml-auto text-2xs text-muted-foreground">
                      {d.userName ?? "System"} · {relativeTime(d.createdAt)}
                    </span>
                  </div>
                  {d.reason ? <p className="mt-1 text-xs leading-relaxed">{d.reason}</p> : <p className="mt-1 text-2xs text-muted-foreground">{tx("No reason recorded.")}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-3 text-2xs text-muted-foreground">{tx("No editorial decision has needed a justification yet.")}</p>
          )}
        </section>

        <section>
          <SectionTitle>
            {tx("Action log")}{" "}<span className="tabular ml-1.5 font-normal text-muted-foreground">{rows.length} {" "}{tx("most recent")}</span>
          </SectionTitle>
          {rows.length ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left">
                  <tr className="label-caps">
                    <th className="px-3 py-2 font-medium">{tx("When")}</th>
                    <th className="px-3 py-2 font-medium">{tx("Who")}</th>
                    <th className="px-3 py-2 font-medium">{tx("Action")}</th>
                    <th className="px-3 py-2 font-medium">{tx("Entity")}</th>
                    <th className="px-3 py-2 font-medium">{tx("Edition")}</th>
                    <th className="px-3 py-2 font-medium">{tx("Details")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="bg-card align-top">
                      <td className="tabular px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.userName ?? <span className="text-muted-foreground">{tx("System")}</span>}</td>
                      <td className="px-3 py-2 font-mono text-2xs">{r.action}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.entityType ? enumLabel(r.entityType) : "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{r.editionLabel ?? "—"}</td>
                      <td className="max-w-[320px] px-3 py-2 font-mono text-2xs break-all text-muted-foreground">
                        {r.metadata && Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ScrollText} title={tx("Nothing recorded yet")} description={tx("Actions appear here as soon as someone works on an edition.")} />
          )}
        </section>
      </PageBody>
    </>
  );
}
