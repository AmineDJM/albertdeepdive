import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, Info } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getEdition } from "@/server/editions/service";
import { qualityGates } from "@/server/publication/validate";
import { listVersions } from "@/server/publication/versions";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { validateEditionDocument, kindForEditionStatus } from "@/server/publication/validate";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { QualityGates } from "@/components/newsroom/quality-gates";
import { PublishControls } from "@/components/newsroom/publish-controls";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { SeverityBadge } from "@/components/newsroom/status-badge";
import { Badge } from "@/components/ui/badge";
import { nextStatuses, type EditionStatus } from "@/lib/editorial/edition-state";

export const dynamic = "force-dynamic";

export default async function QaPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const user = await getCurrentUser();
  const edition = await getEdition(editionId).catch(() => null);
  if (!edition) notFound();

  const [gates, versions, doc] = await Promise.all([
    qualityGates(editionId),
    listVersions(editionId),
    buildEditionDocument(editionId, { versionLabel: "qa", includeUnapproved: true }),
  ]);
  const report = validateEditionDocument(doc, { kind: kindForEditionStatus(edition.status) });

  const blocking = gates.filter((g) => g.blocking && g.status !== "pass");
  const passed = gates.filter((g) => g.status === "pass").length;
  const overridden = gates.filter((g) => g.overridden).length;
  const errors = report.issues.filter((i) => i.severity === "error");
  const warnings = report.issues.filter((i) => i.severity === "warning");
  const infos = report.issues.filter((i) => i.severity === "info");

  const publishable = versions.filter((v) => v.kind === "PUBLISHED" && v.status === "READY").map((v) => ({ id: v.id, label: v.label }));

  return (
    <>
      <PageHeader
        title="QA & publish"
        description={`${passed} of ${gates.length} gates pass${overridden ? ` · ${overridden} overridden` : ""} · ${blocking.length} blocking`}
        actions={
          <PublishControls
            editionId={editionId}
            status={edition.status as EditionStatus}
            nextStatuses={nextStatuses(edition.status as EditionStatus)}
            publishableVersions={publishable}
            blockingCount={blocking.length}
            canPublish={hasPermission(user, "edition:publish")}
            canEdit={hasPermission(user, "edition:edit")}
          />
        }
      />

      <PageBody className="space-y-5">
        <StatGrid columns={4}>
          <Stat label="Gates passing" value={`${passed}/${gates.length}`} tone={blocking.length ? "warning" : "success"} hint={blocking.length ? `${blocking.length} still blocking` : "Ready to publish"} />
          <Stat label="Errors" value={errors.length} tone={errors.length ? "destructive" : "success"} hint="Must be nil to publish" />
          <Stat label="Warnings" value={warnings.length} tone={warnings.length ? "warning" : "muted"} hint="Worth a look" />
          <Stat label="Pages planned" value={doc.pages.length} hint={`${doc.articles.length} articles`} tone="brand" />
        </StatGrid>

        {blocking.length === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success-soft/40 px-3.5 py-2.5 text-xs">
            <CheckCircle2 className="size-4 shrink-0 text-success" />
            <span>Every blocking gate passes. The issue can go to press.</span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-3.5 py-2.5 text-xs">
            <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
            <span>
              Publication is blocked by {blocking.length} gate{blocking.length === 1 ? "" : "s"}: {blocking.map((g) => g.label).join(", ")}.
            </span>
          </p>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section>
            <SectionTitle>Publication checklist</SectionTitle>
            <QualityGates editionId={editionId} gates={gates} canOverride={hasPermission(user, "qa:override")} />
            <p className="mt-2 text-2xs text-muted-foreground">
              Only the editor in chief can override a gate, and every override needs a written reason. Prohibited (RED) media, the contents list and page numbering can never be overridden.
            </p>
          </section>

          <aside className="space-y-5">
            <section>
              <SectionTitle>
                Validation report
                <span className="tabular ml-1.5 font-normal text-muted-foreground">{report.issues.length} items</span>
              </SectionTitle>
              {report.issues.length ? (
                <ul className="max-h-[520px] space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-2.5">
                  {[...errors, ...warnings, ...infos].map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 text-2xs leading-relaxed">
                      <SeverityBadge severity={issue.severity} />
                      <span className="flex-1">
                        {issue.message}
                        {issue.page ? <span className="tabular ml-1 text-muted-foreground">p.{issue.page}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-3 text-2xs text-muted-foreground">Nothing to report.</p>
              )}
            </section>

            <section>
              <SectionTitle>Versions</SectionTitle>
              <ul className="space-y-1.5">
                {versions.slice(0, 6).map((v) => (
                  <li key={v.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-xs">
                    <span className="tabular font-medium">{v.label}</span>
                    <Badge variant={v.status === "READY" ? "success" : v.status === "FAILED" ? "destructive" : "muted"} className="text-2xs">
                      {v.status.toLowerCase()}
                    </Badge>
                    <span className="ml-auto text-2xs text-muted-foreground">{v.assets.length} file{v.assets.length === 1 ? "" : "s"}</span>
                  </li>
                ))}
                {!versions.length ? <li className="rounded-md border border-dashed border-border p-3 text-2xs text-muted-foreground">No version has been generated yet.</li> : null}
              </ul>
              <Link href={`/editions/${editionId}/exports`} className="mt-2 inline-flex items-center gap-1 text-2xs text-brand hover:underline">
                Go to exports <ExternalLink className="size-3" />
              </Link>
            </section>

            <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
              <Info className="mt-px size-3 shrink-0" />
              <span>The checklist is recomputed from the database on every visit, so it always reflects the current state of the issue.</span>
            </p>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
