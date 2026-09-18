import Link from "next/link";
import { Suspense } from "react";
import { Images, Sparkles } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { getCurrentEdition } from "@/server/editions/service";
import { env } from "@/server/env";
import { LIBRARY_CATEGORIES, listMedia, listStoriesForPicker, mediaStats, type LibraryCategory } from "@/server/media/library";
import { KIND_LABELS, MEDIA_KINDS } from "@/server/media/constants";
import { RIGHTS_STATUS_LABELS } from "@/lib/constants";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { MediaLibrary } from "@/components/media/media-library";
import { UploadDialog } from "@/components/media/upload-dialog";
import { ViewToggle, type MediaView } from "@/components/media/view-toggle";
import { FilterChips } from "@/components/media/filter-chips";
import { MediaPagination } from "@/components/media/pagination";
import { GenerateImageDialog } from "@/components/images/generate-image-dialog";
import { mayShowRouting, pendingViews, referenceCandidates } from "@/server/images/views";
import { PicturesInProgress } from "@/components/images/pictures-in-progress";
import { cn } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * The Library: the organisation's visual memory.
 *
 * Every picture the workspace has ever been given, in one place, on shelves nobody had to file it
 * on. Approved is a rights status, not a folder; Archived is a state, not a bin. Uploads land here
 * without an edition, and the creative engine reads from here before it draws anything.
 */

const FILTER_KEYS = ["q", "rights", "kind", "quality", "duplicates", "unused", "archived", "category", "sort", "view", "page"] as const;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tr = await getUi();
  const raw = await searchParams;
  const sp: Record<string, string | undefined> = {};
  for (const key of FILTER_KEYS) {
    const v = raw[key];
    sp[key] = Array.isArray(v) ? v[0] : v;
  }
  const view: MediaView = sp.view === "list" ? "list" : "grid";
  const [user, tenant, current] = await Promise.all([getCurrentUser(), requireTenant(), getCurrentEdition()]);
  const canManage = hasPermission(user, "media:manage");
  const canRights = hasPermission(user, "media:rights");
  const showRouting = await mayShowRouting(user);
  const [stats, list, stories, pending, candidates] = await Promise.all([
    mediaStats(null, tenant.organizationId),
    listMedia(null, { ...sp, pageSize: view === "list" ? 60 : 48 }, tenant.organizationId),
    current ? listStoriesForPicker(current.id) : Promise.resolve([]),
    pendingViews(tenant.organizationId, null, { showRouting }),
    canManage ? referenceCandidates(tenant.organizationId, null) : Promise.resolve([]),
  ]);
  const hasFilters = FILTER_KEYS.some((k) => k !== "view" && k !== "page" && k !== "sort" && sp[k]);
  const shelves: Record<LibraryCategory, string> = { people: tr("People"), team: tr("Team"), events: tr("Events"), office: tr("Office"), product: tr("Product"), logo: tr("Logo"), screenshots: tr("Screenshots"), illustrations: tr("Illustrations"), generated: tr("Generated"), documents: tr("Documents") };
  const qs = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...sp, ...patch, page: undefined };
    const next = new URLSearchParams(Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `/library${next.toString() ? `?${next}` : ""}`;
  };
  const shelf = (key: string, label: string, active: boolean) => (
    <Link key={key} href={qs(active ? { category: undefined, archived: undefined, rights: undefined } : key === "approved" ? { rights: "GREEN", category: undefined, archived: undefined } : key === "archived" ? { archived: "true", category: undefined, rights: undefined } : { category: key, archived: undefined, rights: undefined })} className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150", active ? "bg-brand-soft text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title={tr("Library")}
        description={tr("{total} assets · {cleared} approved · {unused} unused{archived}", { total: stats.total, cleared: stats.byRights.GREEN, unused: stats.unused, archived: stats.archived ? ` · ${stats.archived} ${tr("archived")}` : "" })}
        actions={
          <>
            <Suspense>
              <ViewToggle view={view} />
            </Suspense>
            {canManage ? <GenerateImageDialog editionId={null} candidates={candidates} /> : null}
            {canManage ? <UploadDialog editionId={null} stories={stories} maxFileMb={env.UPLOAD_MAX_FILE_MB} /> : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-5 py-2">
        {shelf("all", tr("Everything"), !sp.category && !sp.archived && !sp.rights)}
        {(Object.keys(LIBRARY_CATEGORIES) as LibraryCategory[]).map((key) => shelf(key, shelves[key], sp.category === key))}
        <span className="mx-1 h-4 w-px bg-border" />
        {shelf("approved", tr("Approved"), sp.rights === "GREEN")}
        {shelf("archived", tr("Archived"), sp.archived === "true")}
      </div>
      <PageBody className="space-y-4">
        <PicturesInProgress versions={pending} />
        <Suspense>
          <FilterBar
            searchPlaceholder={tr("Search by what is in the picture, a caption, a file name…")}
            filters={[
              { key: "rights", label: tr("Rights"), options: [{ value: "GREEN", label: `${RIGHTS_STATUS_LABELS.GREEN} (${list.facets.rights.GREEN})` }, { value: "YELLOW", label: `${RIGHTS_STATUS_LABELS.YELLOW} (${list.facets.rights.YELLOW})` }, { value: "RED", label: `${RIGHTS_STATUS_LABELS.RED} (${list.facets.rights.RED})` }] },
              { key: "kind", label: tr("Kinds"), options: MEDIA_KINDS.map((k) => ({ value: k, label: `${KIND_LABELS[k]}${list.facets.kind[k] ? ` (${list.facets.kind[k]})` : ""}` })) },
              { key: "quality", label: tr("Quality"), options: [{ value: "low", label: tr("Low quality (< 60)") }, { value: "ok", label: tr("Usable (≥ 60)") }], allLabel: tr("Any quality") },
              { key: "sort", label: tr("Sort"), options: [{ value: "oldest", label: tr("Oldest first") }, { value: "quality", label: tr("Best quality first") }, { value: "size", label: tr("Largest first") }, { value: "name", label: tr("File name") }], allLabel: tr("Newest first") },
            ]}
          >
            <FilterChips />
          </FilterBar>
        </Suspense>

        {list.rows.length ? (
          <>
            <MediaLibrary rows={list.rows} editionId={null} view={view} canManage={canManage} canRights={canRights} />
            <MediaPagination page={list.page} pageCount={list.pageCount} total={list.total} pageSize={list.pageSize} basePath="/library" params={sp} />
          </>
        ) : hasFilters ? (
          <EmptyState icon={Images} title={tr("Nothing on this shelf")} description={tr("Try a broader search, clear a filter, or look on another shelf.")} compact />
        ) : (
          <EmptyState
            icon={Sparkles}
            title={tr("Your visual memory starts here.")}
            description={tr("Upload the images, videos and brand assets Briefly should know about. Briefly sorts them; you never file a thing.")}
            action={canManage ? <UploadDialog editionId={null} stories={stories} maxFileMb={env.UPLOAD_MAX_FILE_MB} /> : null}
          />
        )}
        {!canManage && !list.rows.length ? null : (
          <p className="text-2xs text-muted-foreground">{tr("Real assets first: when Briefly makes a picture, it looks here before it draws anything.")}</p>
        )}
        {!canManage ? (
          <Button asChild variant="link" size="sm" className="px-0">
            <Link href="/editions">{tr("Pictures are added from an edition’s media tab.")}</Link>
          </Button>
        ) : null}
      </PageBody>
    </>
  );
}
