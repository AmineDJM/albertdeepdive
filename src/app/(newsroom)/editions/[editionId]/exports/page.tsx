import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getEdition } from "@/server/editions/service";
import { listVersions, type PublicationKind } from "@/server/publication/versions";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { ExportPanel, type VersionView } from "@/components/newsroom/export-panel";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBytes } from "@/server/media/constants";
import { creatorNames } from "@/server/publication/creators";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/** Which version types make sense at this point in the edition's life. */
function allowedKinds(status: string): PublicationKind[] {
  if (status === "FINAL_REVIEW") return ["PUBLISHED", "FINAL_REVIEW", "EDITORIAL_REVIEW", "DRAFT"];
  if (status === "LAYOUT") return ["FINAL_REVIEW", "EDITORIAL_REVIEW", "DRAFT"];
  if (status === "PUBLISHED" || status === "ARCHIVED") return [];
  return ["EDITORIAL_REVIEW", "DRAFT"];
}

export default async function ExportsPage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();
  const edition = await getEdition(editionId).catch(() => null);
  if (!edition) notFound();
  const versions = await listVersions(editionId);
  const kinds = allowedKinds(edition.status);
  const creators = await creatorNames(versions.map((v) => v.createdById));
  const canRun = hasPermission(user, "export:run") && kinds.length > 0;

  const ready = versions.filter((v) => v.status === "READY");
  const latestReady = ready[0] ?? null;
  const pdf = latestReady?.assets.find((a) => a.kind === "PDF") ?? null;
  const latestReadyPages = pdf?.pageCount ?? latestReady?.layoutReport?.pageCount ?? null;
  const docx = latestReady?.assets.find((a) => a.kind === "DOCX") ?? null;

  const views: VersionView[] = versions.map((v) => ({
    id: v.id,
    label: v.label,
    kind: v.kind,
    status: v.status,
    sequence: v.sequence,
    isImmutable: v.isImmutable,
    notes: v.notes,
    createdAt: v.createdAt,
    createdByName: creators.get(v.createdById ?? "") ?? null,
    pageCount: v.assets.find((a) => a.kind === "PDF")?.pageCount ?? v.layoutReport?.pageCount ?? null,
    renderMs: v.completedAt ? v.completedAt.getTime() - v.createdAt.getTime() : null,
    renderLog: v.renderLog ?? [],
    layoutStats: (v.layoutReport?.stats as Record<string, number> | undefined) ?? null,
    assets: v.assets.map((a) => ({ id: a.id, kind: a.kind, fileName: a.fileName, sizeBytes: a.sizeBytes, pageCount: a.pageCount })),
  }));

  return (
    <>
      <PageHeader
        title={tr("Exports")}
        description={`${versions.length} version${versions.length === 1 ? "" : "s"} · ${ready.length} rendered · the PDF and the Word document are always built from the same snapshot`}
      />
      <PageBody className="space-y-5">
        <StatGrid columns={4}>
          <Stat label={tr("Latest rendered")} value={latestReady?.label ?? "—"} hint={latestReady ? latestReady.kind.replace(/_/g, " ").toLowerCase() : "Nothing rendered yet"} />
          <Stat label={tr("Pages")} value={latestReadyPages ?? "—"} hint={tr("A4 portrait")} tone="brand" />
          <Stat label={tr("PDF")} value={pdf ? formatBytes(pdf.sizeBytes) : "—"} hint={pdf?.fileName ?? "Not generated"} />
          <Stat label={tr("Word")} value={docx ? formatBytes(docx.sizeBytes) : "—"} hint={docx?.fileName ?? "Not generated"} />
        </StatGrid>

        {versions.length ? (
          <section>
            <SectionTitle>{tr("Versions")}</SectionTitle>
            <ExportPanel editionId={editionId} versions={views} allowedKinds={kinds} canRun={canRun} />
          </section>
        ) : canRun ? (
          <section>
            <SectionTitle>{tr("Generate the issue")}</SectionTitle>
            <ExportPanel editionId={editionId} versions={[]} allowedKinds={kinds} canRun={canRun} />
          </section>
        ) : (
          <EmptyState icon={FileDown} title={tr("No export yet")} description={tr("Once the flatplan is validated, generate a version here to produce the PDF and the Word document together.")} />
        )}
      </PageBody>
    </>
  );
}
