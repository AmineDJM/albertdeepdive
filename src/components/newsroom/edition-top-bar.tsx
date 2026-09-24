"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { InlineRename } from "./inline-rename";
import { updateEditionAction } from "@/app/(newsroom)/editions/actions";
import { useUi } from "@/components/i18n/provider";

/**
 * The line above every screen of an edition: the way back, and the edition's name.
 *
 * Back is always top left and always goes one level up. From the edition's own screen — the table
 * of what Briefly decided — that is the newsletter it belongs to. From any screen opened from that
 * table it is the table, so configuring something and pressing Back lands where the configuring
 * started.
 */
export function EditionTopBar({ editionId, issueNumber, label, newsletter, canRename, children }: { editionId: string; issueNumber: number; label: string; newsletter: { id: string; name: string } | null; canRename: boolean; children?: React.ReactNode }) {
  const tr = useUi();
  const pathname = usePathname();
  const home = `/editions/${editionId}`;
  const onTable = pathname === home;
  const back = onTable ? (newsletter ? { href: `/publications/${newsletter.id}`, label: newsletter.name } : { href: "/overview", label: tr("Home") }) : { href: home, label: tr("Back to the edition") };
  return (
    <div className="flex min-w-0 flex-col justify-center px-5 py-1.5">
      <Link href={back.href} data-testid="page-back" className="inline-flex w-fit items-center gap-1 rounded-sm text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
        <ArrowLeft className="size-3" /> {back.label}
      </Link>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[13px] font-semibold text-muted-foreground">
          {tr("Edition")} #{issueNumber}
        </span>
        <InlineRename value={label} label={tr("Rename the edition")} disabled={!canRename} maxLength={60} className="text-[14px] font-semibold text-foreground" onSave={(next) => updateEditionAction(editionId, { label: next })} />
        {children}
      </div>
    </div>
  );
}
