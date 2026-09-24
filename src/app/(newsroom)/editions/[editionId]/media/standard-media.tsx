import Link from "next/link";
import { Images, TriangleAlert } from "lucide-react";
import { env } from "@/server/env";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listMedia, listStoriesForPicker, mediaStats } from "@/server/media/library";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { MediaLibrary } from "@/components/media/media-library";
import { MediaPagination } from "@/components/media/pagination";
import { UploadDialog } from "@/components/media/upload-dialog";
import { GenerateImageDialog } from "@/components/images/generate-image-dialog";
import { PicturesInProgress } from "@/components/images/pictures-in-progress";
import { mayShowRouting, pendingViews, referenceCandidates } from "@/server/images/views";
import { requireTenant } from "@/server/tenancy/context";
import { getUi } from "@/server/i18n/locale";

/**
 * Pictures, in Standard: the pictures.
 *
 * What stood here was six counters, six filters, a sort, two saved searches called Duplicates and
 * Unused, a "describe them with the AI" button and then, underneath all of it, the photographs.
 * Every one of those is a real tool and every one of them is a question — and the page is opened
 * by somebody who wants to see what they have and add what is missing.
 *
 * So: the pictures, one button to add some, one to have Briefly draw one, and a single line when
 * something genuinely needs a person, because a photograph nobody has the rights to is the one
 * thing on this page that can stop an edition going out. The counters, the filters and the rest
 * are one switch away in Advanced, and the rights line links into the same filtered view they
 * open.
 */
export async function StandardMedia({ editionId, rights, page }: { editionId: string; rights?: string; page?: string }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  const canManage = hasPermission(user, "media:manage");
  const canRights = hasPermission(user, "media:rights");
  const tenant = await requireTenant();
  const showRouting = await mayShowRouting(user);
  const basePath = `/editions/${editionId}/media`;
  const [stats, list, stories, pending, candidates] = await Promise.all([
    mediaStats(editionId),
    listMedia(editionId, { rights, page, pageSize: 48 }),
    listStoriesForPicker(editionId),
    pendingViews(tenant.organizationId, editionId, { showRouting }),
    canManage ? referenceCandidates(tenant.organizationId, editionId) : Promise.resolve([]),
  ]);
  const unclear = stats.byRights.YELLOW + stats.byRights.RED;

  return (
    <>
      <PageHeader
        title={tr("Pictures")}
        description={stats.total === 1 ? tr("1 picture in this edition") : tr("{count} pictures in this edition", { count: stats.total })}
        actions={
          canManage ? (
            <>
              <GenerateImageDialog editionId={editionId} candidates={candidates} />
              <UploadDialog editionId={editionId} stories={stories} maxFileMb={env.UPLOAD_MAX_FILE_MB} />
            </>
          ) : null
        }
      />
      <PageBody className="space-y-4">
        <PicturesInProgress versions={pending} />

        {unclear ? (
          <Link
            href={rights ? basePath : `${basePath}?rights=YELLOW`}
            className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-warning transition-colors hover:border-warning/60"
          >
            <TriangleAlert className="size-4 shrink-0" />
            <span>
              {unclear === 1 ? tr("1 picture has no clear permission to be published.") : tr("{count} pictures have no clear permission to be published.", { count: unclear })}{" "}
              <span className="underline">{rights ? tr("Show all the pictures") : tr("Look at them")}</span>
            </span>
          </Link>
        ) : null}

        {list.rows.length ? (
          <>
            <MediaLibrary rows={list.rows} editionId={editionId} view="grid" canManage={canManage} canRights={canRights} />
            <MediaPagination page={list.page} pageCount={list.pageCount} total={list.total} pageSize={list.pageSize} basePath={basePath} params={{ rights }} />
          </>
        ) : rights ? (
          <EmptyState icon={Images} title={tr("Nothing here")} description={tr("Every picture in this edition is cleared.")} action={<Link href={basePath} className="text-[13px] text-brand hover:underline">{tr("Show all the pictures")}</Link>} />
        ) : (
          <EmptyState
            icon={Images}
            title={tr("No pictures yet")}
            description={tr("Photographs sent with a contribution land here on their own. You can add your own, or have Briefly draw one.")}
            action={canManage ? <UploadDialog editionId={editionId} stories={stories} maxFileMb={env.UPLOAD_MAX_FILE_MB} /> : null}
          />
        )}
      </PageBody>
    </>
  );
}
