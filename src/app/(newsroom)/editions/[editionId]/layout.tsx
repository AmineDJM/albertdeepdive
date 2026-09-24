import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { EditionTopBar } from "@/components/newsroom/edition-top-bar";
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
 * The way back (top left, one level up), the edition's name — which can be changed where it is
 * read — and where it stands. Advanced gets the doors under it; Standard gets nothing, because its
 * navigation is the edition's own screen. Doors a reader may not open are not drawn, and a door
 * with no rooms left is not drawn either.
 */
export default async function EditionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const tr = await getUi();
  const user = await getCurrentUser();
  const edition = await getEdition(editionId).catch(() => null);
  if (!edition || !user) notFound();
  const doors: EditionDoor[] = EDITION_DOORS.map((door) => ({ ...door, rooms: door.rooms.filter((room) => !(room.permission ?? door.permission) || roleHasPermission(user.role, (room.permission ?? door.permission)!)) })).filter((door) => door.rooms.length > 0);
  const newsletter = edition.publicationId ? ((await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId), columns: { id: true, name: true } })) ?? null) : null;
  const analyticsHref = hasPermission(user, "analytics:view") && (edition.status === "PUBLISHED" || edition.status === "ARCHIVED") ? `/analytics?editionId=${edition.id}` : null;
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <EditionTopBar editionId={edition.id} issueNumber={edition.issueNumber} label={edition.label} newsletter={newsletter} canRename={hasPermission(user, "edition:edit")}>
          <EditionStatusBadge status={edition.status} />
          <span className="hidden text-2xs text-muted-foreground sm:inline">{tr(standingOf(edition.status as EditionStatus))}</span>
        </EditionTopBar>
        <EditionNav editionId={edition.id} doors={doors} analyticsHref={analyticsHref} />
      </div>
      {children}
    </div>
  );
}
