import Link from "next/link";
import { notFound } from "next/navigation";
import { getEdition } from "@/server/editions/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { roleHasPermission } from "@/lib/auth/permissions";
import { EDITION_DOORS, type EditionDoor } from "@/components/newsroom/nav";
import { EditionNav } from "@/components/newsroom/edition-nav";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { standingOf } from "@/lib/editorial/edition-steps";
import { getUi } from "@/server/i18n/locale";

/**
 * An edition, as a focused workspace.
 *
 * One line: the edition's name — which is the way back to it — and where it stands. Advanced gets
 * the doors under it; Standard gets nothing, because its navigation is the edition's own screen.
 * Doors a reader may not open are not drawn, and a door with no rooms left is not drawn either.
 */
export default async function EditionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const tr = await getUi();
  const user = await getCurrentUser();
  const edition = await getEdition(editionId).catch(() => null);
  if (!edition || !user) notFound();
  const doors: EditionDoor[] = EDITION_DOORS.map((door) => ({ ...door, rooms: door.rooms.filter((room) => !(room.permission ?? door.permission) || roleHasPermission(user.role, (room.permission ?? door.permission)!)) })).filter((door) => door.rooms.length > 0);
  const analyticsHref = hasPermission(user, "analytics:view") && (edition.status === "PUBLISHED" || edition.status === "ARCHIVED") ? `/analytics?editionId=${edition.id}` : null;
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-11 min-w-0 items-center gap-2 px-5">
          <Link href={`/editions/${edition.id}`} className="truncate text-[13px] font-semibold hover:underline">
            {tr("Edition")} #{edition.issueNumber} <span className="font-normal text-muted-foreground">· {edition.label}</span>
          </Link>
          <EditionStatusBadge status={edition.status} />
          <span className="hidden text-2xs text-muted-foreground sm:inline">{tr(standingOf(edition.status as EditionStatus))}</span>
        </div>
        <EditionNav editionId={edition.id} doors={doors} analyticsHref={analyticsHref} />
      </div>
      {children}
    </div>
  );
}
