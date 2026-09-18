"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTranslations, useUi } from "@/components/i18n/provider";
import type { EditionDoor } from "./nav";

/**
 * The two rows an edition wears: the doors, and the rooms behind the open one.
 *
 * The second row appears only when a door has more than one room, so Overview and Distribution
 * stay a single line. Both rows read the path, so a link from anywhere lands with the right door
 * lit and the right room underlined.
 */
export function EditionTabs({ editionId, doors, analyticsHref }: { editionId: string; doors: EditionDoor[]; analyticsHref: string | null }) {
  const tr = useUi();
  const t = useTranslations();
  const pathname = usePathname();
  const base = `/editions/${editionId}`;
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\//, "") : "";
  const slug = rest.split("/")[0] ?? "";
  const open = doors.find((door) => door.rooms.some((room) => room.slug === slug)) ?? doors[0];
  const hrefFor = (roomSlug: string) => `${base}${roomSlug ? `/${roomSlug}` : ""}`;

  return (
    <div className="min-w-0 flex-1">
      <nav className="flex h-11 items-center gap-0.5 overflow-x-auto scrollbar-thin" aria-label={tr("Sections")}>
        {doors.map((door) => {
          const active = door.key === open?.key;
          return (
            <Link key={door.key} href={hrefFor(door.rooms[0].slug)} aria-current={active ? "page" : undefined} className={cn("relative flex h-11 items-center px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t(door.label)}
              {active ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-brand" /> : null}
            </Link>
          );
        })}
        {analyticsHref ? (
          <Link href={analyticsHref} className="flex h-11 items-center px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-foreground">
            {t("editionTabs.analytics")}
          </Link>
        ) : null}
      </nav>
      {open && open.rooms.length > 1 ? (
        <nav className="flex h-9 items-center gap-1 border-t border-border/70" aria-label={t(open.label)}>
          {open.rooms.map((room) => {
            const active = room.slug === slug;
            return (
              <Link key={room.slug} href={hrefFor(room.slug)} aria-current={active ? "page" : undefined} className={cn("rounded-md px-2 py-1 text-xs font-medium transition-colors duration-150", active ? "bg-brand-soft text-brand-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {t(room.label)}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
