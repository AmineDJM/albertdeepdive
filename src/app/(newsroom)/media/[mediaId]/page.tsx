import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getMediaDetail, listStoriesForPicker } from "@/server/media/library";
import {
  aspectLabel,
  formatBytes,
  formatDimensions,
  KIND_LABELS,
  LOW_QUALITY_THRESHOLD,
  PRINT_READY_MIN_WIDTH,
  qualityTone,
  type MediaKind,
} from "@/server/media/constants";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { RightsBadge } from "@/components/newsroom/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QualityFlags } from "@/components/media/quality-flags";
import { MetadataForm } from "@/components/media/detail/metadata-form";
import { RightsPanel } from "@/components/media/detail/rights-panel";
import { UsagePanel } from "@/components/media/detail/usage-panel";
import { SimilarStrip } from "@/components/media/detail/similar-strip";
import { CropsPanel } from "@/components/media/detail/crops-panel";
import { AiPanel } from "@/components/media/detail/ai-panel";
import { ArchiveButton } from "@/components/media/detail/archive-button";
import { AuditTrail } from "@/components/media/detail/audit-trail";
import { VariantsList } from "@/components/media/detail/variants-list";
import { cn, enumLabel, formatDate, formatDateTime } from "@/lib/utils";
import { storyTypeLabel } from "@/lib/constants";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const CHECKER =
  "repeating-conic-gradient(color-mix(in oklch, var(--foreground) 6%, transparent) 0% 25%, transparent 0% 50%) 50% / 16px 16px";
const toneClass = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
} as const;

export default async function MediaDetailPage({
  params,
}: {
  params: Promise<{ mediaId: string }>;
}) {
  const tr = await getUi();
  const { mediaId } = await params;
  const user = await getCurrentUser();
  const detail = await getMediaDetail(mediaId).catch(() => null);
  if (!detail) notFound();
  const canManage = hasPermission(user, "media:manage");
  const canRights = hasPermission(user, "media:rights");
  const a = detail.asset;
  const title = a.caption || a.fileName;
  const pickerStories = detail.edition ? await listStoriesForPicker(detail.edition.id) : [];
  const cropVariant = detail.variants.find((v) => v.kind === "CROP") ?? null;
  const mediaBase = detail.edition ? `/editions/${detail.edition.id}/media` : "/media";
  const editionId = detail.edition?.id ?? null;
  const printReady = (a.width ?? 0) >= PRINT_READY_MIN_WIDTH && a.rightsStatus === "GREEN";
  const meta = a.metadata as {
    density?: number | null;
    hasAlpha?: boolean;
    space?: string | null;
    exifBytes?: number;
    describedAt?: string;
  };
  const lowQuality = a.qualityScore !== null && a.qualityScore < LOW_QUALITY_THRESHOLD;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: tr("Editions"), href: "/editions" },
          ...(detail.edition
            ? [{ label: detail.edition.label, href: `/editions/${detail.edition.id}` }]
            : []),
          { label: tr("Media"), href: mediaBase },
          { label: a.fileName },
        ]}
        title={title}
        meta={
          <>
            <RightsBadge status={a.rightsStatus} />
            <Badge variant="outline">{KIND_LABELS[a.kind as MediaKind] ?? enumLabel(a.kind)}</Badge>
            {printReady ? <Badge variant="success">{tr("Print-ready")}</Badge> : null}
            {a.duplicateOfId ? <Badge variant="red">{tr("Duplicate")}</Badge> : null}
            {a.isArchived ? <Badge variant="muted">{tr("Archived")}</Badge> : null}
          </>
        }
        description={`${a.fileName} · ${formatDimensions(a.width, a.height)} · ${formatBytes(a.sizeBytes)} · added ${formatDate(a.createdAt)}${detail.contributor ? ` by ${detail.contributor.name}` : detail.uploadedBy ? ` by ${detail.uploadedBy.name}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={detail.originalDownloadUrl}>
                <Download />{" "}{tr("Original")}</a>
            </Button>
            {canManage ? (
              <ArchiveButton
                assetId={a.id}
                editionId={editionId}
                isArchived={a.isArchived}
                usedIn={detail.stories.length}
              />
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-6">
            <section>
              <div className="border-border bg-card overflow-hidden rounded-lg border shadow-xs">
                <a
                  href={detail.originalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex max-h-[560px] items-center justify-center"
                  style={{ background: CHECKER }}
                  title={tr("Open the original in a new tab")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={detail.previewUrl}
                    alt={a.altText ?? title}
                    className={cn(
                      "max-h-[560px] w-auto max-w-full object-contain",
                      a.isArchived && "opacity-70 grayscale",
                    )}
                  />
                </a>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t px-4 py-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  <div>
                    <dt className="label-caps">{tr("Dimensions")}</dt>
                    <dd className="tabular mt-0.5 font-medium">
                      {formatDimensions(a.width, a.height)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label-caps">{tr("Aspect")}</dt>
                    <dd className="tabular mt-0.5 font-medium">
                      {a.width && a.height ? aspectLabel(a.width, a.height) : "—"}{" "}
                      <span className="text-muted-foreground">{a.orientation ?? ""}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="label-caps">{tr("Format")}</dt>
                    <dd className="mt-0.5 font-medium uppercase">{a.format ?? a.mimeType}</dd>
                  </div>
                  <div>
                    <dt className="label-caps">{tr("Size")}</dt>
                    <dd className="tabular mt-0.5 font-medium">{formatBytes(a.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt className="label-caps">{tr("Quality")}</dt>
                    <dd
                      className={cn(
                        "tabular mt-0.5 font-medium",
                        toneClass[qualityTone(a.qualityScore)],
                      )}
                    >
                      {a.qualityScore ?? "—"}
                      <span className="text-muted-foreground"> / 100</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="label-caps">{tr("Print")}</dt>
                    <dd
                      className={cn(
                        "mt-0.5 font-medium",
                        printReady ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {printReady
                        ? "Ready"
                        : (a.width ?? 0) < PRINT_READY_MIN_WIDTH
                          ? `Needs ≥ ${PRINT_READY_MIN_WIDTH} px`
                          : "Needs approved rights"}
                    </dd>
                  </div>
                </dl>
                {a.qualityFlags.length || lowQuality ? (
                  <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
                    <span className="label-caps">{tr("Flags")}</span>
                    <QualityFlags flags={a.qualityFlags} />
                  </div>
                ) : null}
              </div>
            </section>

            <section>
              <SectionTitle>{tr("Similar & duplicates")}</SectionTitle>
              <SimilarStrip
                assetId={a.id}
                editionId={editionId}
                similar={detail.similar}
                duplicateOf={detail.duplicateOf}
                canManage={canManage}
              />
            </section>

            <section>
              <SectionTitle>{tr("Crops")}</SectionTitle>
              <CropsPanel
                assetId={a.id}
                editionId={editionId}
                width={a.width ?? 0}
                height={a.height ?? 0}
                previewUrl={detail.previewUrl}
                suggestions={a.suggestedCrops}
                crop={cropVariant}
                canManage={canManage}
              />
            </section>

            <section>
              <SectionTitle>{tr("Files")}</SectionTitle>
              <VariantsList
                original={{
                  url: detail.originalUrl,
                  downloadUrl: detail.originalDownloadUrl,
                  width: a.width,
                  height: a.height,
                  format: a.format,
                  sizeBytes: a.sizeBytes,
                }}
                variants={detail.variants}
              />
            </section>

            <section>
              <SectionTitle>{tr("History")}</SectionTitle>
              <AuditTrail entries={detail.audit} />
            </section>
          </div>

          <aside className="min-w-0 space-y-6">
            <RightsPanel
              assetId={a.id}
              editionId={editionId}
              status={a.rightsStatus}
              note={a.rightsNote}
              consents={detail.consents}
              canRights={canRights}
              contributorName={detail.contributor?.name ?? null}
            />

            <section>
              <SectionTitle>{tr("Caption & credit")}</SectionTitle>
              <div className="border-border bg-card rounded-lg border p-4 shadow-xs">
                <MetadataForm
                  key={a.updatedAt.toISOString()}
                  assetId={a.id}
                  editionId={editionId}
                  canEdit={canManage}
                  value={{
                    caption: a.caption ?? "",
                    altText: a.altText ?? "",
                    photographer: a.photographer ?? "",
                    credit: a.credit ?? "",
                    kind: (KIND_LABELS[a.kind as MediaKind] ? a.kind : "photo") as MediaKind,
                  }}
                />
              </div>
            </section>

            <section>
              <SectionTitle>{tr("Used in")}</SectionTitle>
              <UsagePanel
                assetId={a.id}
                editionId={editionId}
                links={detail.stories}
                bddReferences={detail.bddReferences}
                pickerStories={pickerStories}
                canManage={canManage}
                blocked={a.rightsStatus === "RED"}
              />
            </section>

            <section>
              <SectionTitle>{tr("AI description")}</SectionTitle>
              <div className="border-border bg-card rounded-lg border p-4 shadow-xs">
                <AiPanel
                  assetId={a.id}
                  editionId={editionId}
                  description={a.aiDescription}
                  tags={a.aiTags}
                  lastJob={detail.lastDescribeJob}
                  canManage={canManage}
                />
              </div>
            </section>

            <section>
              <SectionTitle>{tr("Provenance")}</SectionTitle>
              <dl className="border-border bg-card grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border p-4 text-xs shadow-xs">
                <dt className="label-caps self-center">{tr("Edition")}</dt>
                <dd>
                  {detail.edition ? (
                    <Link
                      href={`/editions/${detail.edition.id}`}
                      className="font-medium hover:underline"
                    >
                      {detail.edition.label} ·{" "}
                      {detail.edition.isSpecialIssue ? "Special issue" : "Issue"} N°
                      {detail.edition.issueNumber}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{tr("Not attached to an edition")}</span>
                  )}
                </dd>
                <dt className="label-caps self-center">{tr("Submission")}</dt>
                <dd className="min-w-0">
                  {detail.submission ? (
                    <>
                      <Link
                        href={`/editions/${detail.submission.editionId}/inbox/${detail.submission.id}`}
                        className="block truncate font-medium hover:underline"
                      >
                        {detail.submission.title}
                      </Link>
                      <span className="text-muted-foreground">
                        {storyTypeLabel(detail.submission.storyType)} ·{" "}
                        {tr(enumLabel(detail.submission.status))}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{tr("Uploaded directly")}</span>
                  )}
                </dd>
                <dt className="label-caps self-center">{tr("Contributor")}</dt>
                <dd className="min-w-0">
                  {detail.contributor ? (
                    <>
                      <Link
                        href={`/contributors/${detail.contributor.id}`}
                        className="font-medium hover:underline"
                      >
                        {detail.contributor.name}
                      </Link>
                      <span className="text-muted-foreground">
                        {" "}
                        · {detail.contributor.campusName ?? "School-wide"}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
                <dt className="label-caps self-center">{tr("Uploaded by")}</dt>
                <dd>
                  {detail.uploadedBy ? (
                    detail.uploadedBy.name
                  ) : detail.contributor ? (
                    "Contribution form"
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
                <dt className="label-caps self-center">{tr("Added")}</dt>
                <dd className="tabular">{formatDateTime(a.createdAt)}</dd>
                <dt className="label-caps self-center">{tr("Updated")}</dt>
                <dd className="tabular">{formatDateTime(a.updatedAt)}</dd>
              </dl>
            </section>

            <section>
              <SectionTitle>{tr("Technical details")}</SectionTitle>
              <dl className="border-border bg-card grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border p-4 text-xs shadow-xs">
                <dt className="label-caps self-center">{tr("File")}</dt>
                <dd className="truncate font-medium" title={a.fileName}>
                  {a.fileName}
                </dd>
                <dt className="label-caps self-center">{tr("MIME")}</dt>
                <dd className="text-2xs font-mono">{a.mimeType}</dd>
                <dt className="label-caps self-center">{tr("Colour")}</dt>
                <dd className="flex items-center gap-1.5">
                  {a.dominantColour ? (
                    <span
                      className="border-border inline-block size-3 rounded-sm border"
                      style={{ backgroundColor: a.dominantColour }}
                    />
                  ) : null}
                  <span className="text-2xs font-mono">{a.dominantColour ?? "—"}</span>
                  {meta.space ? (
                    <span className="text-muted-foreground">· {meta.space}</span>
                  ) : null}
                  {meta.hasAlpha ? <span className="text-muted-foreground">{tr("· alpha")}</span> : null}
                </dd>
                <dt className="label-caps self-center">{tr("Orientation")}</dt>
                <dd>
                  {a.orientation ? enumLabel(a.orientation) : "—"}
                  <span className="text-muted-foreground">
                    {" "}
                    · {meta.exifBytes ? "EXIF present, auto-rotated" : "no EXIF data"}
                  </span>
                </dd>
                <dt className="label-caps self-center">{tr("Density")}</dt>
                <dd className="tabular">{meta.density ? `${meta.density} dpi` : "—"}</dd>
                <dt className="label-caps self-center">{tr("Perceptual")}</dt>
                <dd
                  className="text-2xs font-mono"
                  title={tr("dHash, 64 bits — assets within 6 bits are near-duplicates")}
                >
                  {a.phash ?? "—"}
                </dd>
                <dt className="label-caps self-center">{tr("SHA-256")}</dt>
                <dd className="text-2xs truncate font-mono" title={a.sha256 ?? undefined}>
                  {a.sha256 ? `${a.sha256.slice(0, 16)}…` : "—"}
                </dd>
                {a.similarityGroup ? (
                  <>
                    <dt className="label-caps self-center">{tr("Group")}</dt>
                    <dd className="text-2xs font-mono">{a.similarityGroup.slice(0, 8)}</dd>
                  </>
                ) : null}
              </dl>
            </section>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
