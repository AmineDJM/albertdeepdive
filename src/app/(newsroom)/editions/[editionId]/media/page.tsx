import { Suspense } from "react";
import { Images } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { env } from "@/server/env";
import { listMedia, listStoriesForPicker, mediaStats } from "@/server/media/library";
import { KIND_LABELS, MEDIA_KINDS } from "@/server/media/constants";
import { RIGHTS_STATUS_LABELS } from "@/lib/constants";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { MediaLibrary } from "@/components/media/media-library";
import { UploadDialog } from "@/components/media/upload-dialog";
import { ViewToggle, type MediaView } from "@/components/media/view-toggle";
import { FilterChips } from "@/components/media/filter-chips";
import { MediaPagination } from "@/components/media/pagination";
import { DescribeMissingButton } from "@/components/media/describe-missing-button";
import { GenerateImageDialog } from "@/components/images/generate-image-dialog";
import { PicturesInProgress } from "@/components/images/pictures-in-progress";
import { mayShowRouting, pendingViews, referenceCandidates } from "@/server/images/views";
import { requireTenant } from "@/server/tenancy/context";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const FILTER_KEYS = [
  "q",
  "rights",
  "kind",
  "quality",
  "duplicates",
  "unused",
  "archived",
  "storyId",
  "contributorId",
  "sort",
  "view",
  "page",
] as const;

export default async function MediaLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ editionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tr = await getUi();
  const { editionId } = await params;
  const raw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const key of FILTER_KEYS) {
    const v = raw[key];
    sp[key] = Array.isArray(v) ? v[0] : v;
  }
  const view: MediaView = sp.view === "list" ? "list" : "grid";
  const user = await getCurrentUser();
  const canManage = hasPermission(user, "media:manage");
  const canRights = hasPermission(user, "media:rights");
  const basePath = `/editions/${editionId}/media`;

  const tenant = await requireTenant();
  const showRouting = await mayShowRouting(user);
  const [stats, list, stories, pending, candidates] = await Promise.all([
    mediaStats(editionId),
    listMedia(editionId, { ...sp, pageSize: view === "list" ? 60 : 48 }),
    listStoriesForPicker(editionId),
    pendingViews(tenant.organizationId, editionId, { showRouting }),
    canManage ? referenceCandidates(tenant.organizationId, editionId) : Promise.resolve([]),
  ]);
  const hasFilters = FILTER_KEYS.some((k) => k !== "view" && k !== "page" && k !== "sort" && sp[k]);
  const missingDescriptions = Math.max(0, stats.total - stats.described);

  return (
    <>
      <PageHeader
        title={tr("Media")}
        description={`${stats.total} asset${stats.total === 1 ? "" : "s"} · ${stats.printReady} print-ready · ${stats.unused} unused · ${stats.described} described${stats.archived ? ` · ${stats.archived} archived` : ""}`}
        actions={
          <>
            {canManage ? (
              <DescribeMissingButton editionId={editionId} missing={missingDescriptions} />
            ) : null}
            <Suspense>
              <ViewToggle view={view} />
            </Suspense>
            {canManage ? <GenerateImageDialog editionId={editionId} candidates={candidates} /> : null}
            {canManage ? (
              <UploadDialog
                editionId={editionId}
                stories={stories}
                defaultStoryId={sp.storyId}
                maxFileMb={env.UPLOAD_MAX_FILE_MB}
              />
            ) : null}
          </>
        }
      />
      <PageBody className="space-y-4">
        <PicturesInProgress versions={pending} />
        <StatGrid columns={6}>
          <Stat
            label={tr("Assets")}
            value={stats.total}
            hint={`${stats.printReady} print-ready (≥ 1400 px, approved)`}
            href={basePath}
          />
          <Stat
            label={tr("Cleared")}
            value={stats.byRights.GREEN}
            tone="success"
            hint={RIGHTS_STATUS_LABELS.GREEN}
            href={`${basePath}?rights=GREEN`}
          />
          <Stat
            label={tr("Unclear")}
            value={stats.byRights.YELLOW}
            tone={stats.byRights.YELLOW ? "warning" : "muted"}
            hint={tr("rights to confirm")}
            href={`${basePath}?rights=YELLOW`}
          />
          <Stat
            label={tr("Blocked")}
            value={stats.byRights.RED}
            tone={stats.byRights.RED ? "destructive" : "muted"}
            hint={RIGHTS_STATUS_LABELS.RED.toLowerCase()}
            href={`${basePath}?rights=RED`}
          />
          <Stat
            label={tr("Low quality")}
            value={stats.lowQuality}
            tone={stats.lowQuality ? "warning" : "muted"}
            hint={tr("score under 60")}
            href={`${basePath}?quality=low`}
          />
          <Stat
            label={tr("Duplicates")}
            value={stats.duplicates}
            tone={stats.duplicates ? "warning" : "muted"}
            hint={`${stats.inGroups} in similarity groups`}
            href={`${basePath}?duplicates=only`}
          />
        </StatGrid>

        <Suspense>
          <FilterBar
            searchPlaceholder={tr("Search caption, file name, description…")}
            filters={[
              {
                key: "rights",
                label: tr("Rights"),
                options: [
                  {
                    value: "GREEN",
                    label: `${RIGHTS_STATUS_LABELS.GREEN} (${list.facets.rights.GREEN})`,
                  },
                  {
                    value: "YELLOW",
                    label: `${RIGHTS_STATUS_LABELS.YELLOW} (${list.facets.rights.YELLOW})`,
                  },
                  {
                    value: "RED",
                    label: `${RIGHTS_STATUS_LABELS.RED} (${list.facets.rights.RED})`,
                  },
                ],
              },
              {
                key: "kind",
                label: tr("Kinds"),
                options: MEDIA_KINDS.map((k) => ({
                  value: k,
                  label: `${KIND_LABELS[k]}${list.facets.kind[k] ? ` (${list.facets.kind[k]})` : ""}`,
                })),
              },
              {
                key: "quality",
                label: tr("Quality"),
                options: [
                  { value: "low", label: tr("Low quality (< 60)") },
                  { value: "ok", label: tr("Usable (≥ 60)") },
                ],
                allLabel: tr("Any quality"),
              },
              {
                key: "storyId",
                label: tr("Stories"),
                options: stories.map((st) => ({ value: st.id, label: st.title })),
                allLabel: tr("Any story"),
              },
              {
                key: "sort",
                label: tr("Sort"),
                options: [
                  { value: "oldest", label: tr("Oldest first") },
                  { value: "quality", label: tr("Best quality first") },
                  { value: "size", label: tr("Largest first") },
                  { value: "name", label: tr("File name") },
                ],
                allLabel: tr("Newest first"),
              },
            ]}
          >
            <FilterChips />
          </FilterBar>
        </Suspense>

        {list.rows.length ? (
          <>
            <MediaLibrary
              rows={list.rows}
              editionId={editionId}
              view={view}
              canManage={canManage}
              canRights={canRights}
            />
            <MediaPagination
              page={list.page}
              pageCount={list.pageCount}
              total={list.total}
              pageSize={list.pageSize}
              basePath={basePath}
              params={sp}
            />
          </>
        ) : hasFilters ? (
          <EmptyState
            icon={Images}
            title={tr("No media match these filters")}
            description={tr("Try a broader search, clear a filter, or check the archived assets.")}
          />
        ) : (
          <EmptyState
            icon={Images}
            title={tr("No media in this edition yet")}
            description={tr("Photos sent through the contribution form land here automatically. You can also upload files from your computer.")}
            action={
              canManage ? (
                <UploadDialog
                  editionId={editionId}
                  stories={stories}
                  maxFileMb={env.UPLOAD_MAX_FILE_MB}
                />
              ) : null
            }
          />
        )}
      </PageBody>
    </>
  );
}
