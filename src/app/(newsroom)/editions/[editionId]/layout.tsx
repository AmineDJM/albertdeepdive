import { notFound } from "next/navigation";
import { getEdition } from "@/server/editions/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { roleHasPermission } from "@/lib/auth/permissions";
import { EDITION_DOORS, type EditionDoor } from "@/components/newsroom/nav";
import { EditionTabs } from "@/components/newsroom/edition-tabs";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";

/**
 * An edition, as a focused workspace.
 *
 * One bar carries the edition's name and state and the six doors; the page beneath names itself.
 * Doors a reader may not open are not drawn, and a door with no rooms left is not drawn either.
 */
export default async function EditionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const user = await getCurrentUser();
  const edition = await getEdition(editionId).catch(() => null);
  if (!edition || !user) notFound();
  const doors: EditionDoor[] = EDITION_DOORS.map((door) => ({ ...door, rooms: door.rooms.filter((room) => !(room.permission ?? door.permission) || roleHasPermission(user.role, (room.permission ?? door.permission)!)) })).filter((door) => door.rooms.length > 0);
  const analyticsHref = hasPermission(user, "analytics:view") && (edition.status === "PUBLISHED" || edition.status === "ARCHIVED") ? `/analytics?editionId=${edition.id}` : null;
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-start gap-4 px-5">
          <div className="flex h-11 min-w-0 shrink-0 items-center gap-2">
            <span className="truncate text-[13px] font-semibold">
              {edition.label} <span className="font-normal text-muted-foreground">· {edition.isSpecialIssue ? "Special issue" : "Issue"} N°{edition.issueNumber}</span>
            </span>
            <EditionStatusBadge status={edition.status} />
          </div>
          <EditionTabs editionId={edition.id} doors={doors} analyticsHref={analyticsHref} />
        </div>
      </div>
      {children}
    </div>
  );
}
