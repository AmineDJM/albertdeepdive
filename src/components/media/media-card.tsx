"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ImageOff, Link2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RIGHTS_STATUS_LABELS } from "@/lib/constants";
import type { MediaListRow } from "@/server/media/library";
import {
  formatBytes,
  formatDimensions,
  KIND_LABELS,
  LOW_QUALITY_THRESHOLD,
  RIGHTS_DOT_CLASS,
  type MediaKind,
} from "@/server/media/constants";
import { useUi } from "@/components/i18n/provider";

export function MediaCard({
  row,
  selected,
  selectable,
  onToggle,
}: {
  row: MediaListRow;
  selected: boolean;
  selectable: boolean;
  onToggle: (id: string, shift: boolean) => void;
}) {
  const tr = useUi();
  const shiftRef = useRef(false);
  const [broken, setBroken] = useState(false);
  const title = row.caption || row.fileName;
  const low = row.qualityScore !== null && row.qualityScore < LOW_QUALITY_THRESHOLD;
  const isDup = !!row.duplicateOfId;
  const inGroup = !isDup && (row.duplicateGroupSize > 1 || row.duplicatesOfThis > 0);
  return (
    <div
      role="listitem"
      data-media-card
      data-media-id={row.id}
      data-selected={selected}
      className={cn(
        "group border-border bg-card hover:border-foreground/25 relative flex flex-col overflow-hidden rounded-lg border shadow-xs transition-[border-color,box-shadow]",
        selected && "border-brand ring-brand/30 hover:border-brand ring-2",
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 z-10 h-0.5", RIGHTS_DOT_CLASS[row.rightsStatus])}
      />
      <Link
        href={`/media/${row.id}`}
        aria-label={`Open ${title}`}
        className="bg-muted focus-visible:ring-ring/60 relative block aspect-[4/3] overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset"
        onKeyDown={(e) => {
          if (e.key === " " && selectable) {
            e.preventDefault();
            onToggle(row.id, e.shiftKey);
          }
        }}
      >
        {row.thumbUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.thumbUrl}
            alt={row.altText ?? title}
            loading="lazy"
            decoding="async"
            // A thumbnail that does not load leaves the browser's own broken-image glyph and the
            // alt text spilling across the card, which reads as a bug in the library rather than as
            // what it is: the file is not in storage. Say that instead.
            onError={() => setBroken(true)}
            className={cn(
              "size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]",
              row.isArchived && "opacity-60 grayscale",
            )}
          />
        ) : (
          <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-1 px-2 text-center">
            <ImageOff className="size-5" />
            {row.thumbUrl ? <span className="text-2xs leading-tight">{tr("The file is missing from storage")}</span> : null}
          </div>
        )}
        <span
          className={cn(
            "absolute top-2 right-2 size-3 rounded-full shadow ring-2 ring-white",
            RIGHTS_DOT_CLASS[row.rightsStatus],
          )}
          title={`Rights: ${RIGHTS_STATUS_LABELS[row.rightsStatus]}`}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 p-1.5">
          <div className="flex flex-wrap gap-1">
            {low ? <Badge variant="amber">Q {row.qualityScore}</Badge> : null}
            {isDup ? (
              <Badge variant="red">{tr("dup")}</Badge>
            ) : inGroup ? (
              <Badge variant="secondary" className="bg-card/90">
                {tr("similar")}</Badge>
            ) : null}
            {row.kind !== "photo" ? (
              <Badge variant="outline" className="bg-card/90">
                {KIND_LABELS[row.kind as MediaKind] ?? row.kind}
              </Badge>
            ) : null}
            {row.isArchived ? <Badge variant="muted">{tr("archived")}</Badge> : null}
          </div>
          {row.stories.length ? (
            <Badge
              variant="outline"
              className="bg-card/90"
              title={row.stories.map((st) => st.title).join(", ")}
            >
              <Link2 />
              {row.stories.length}
            </Badge>
          ) : null}
        </div>
      </Link>
      {selectable ? (
        <div
          className={cn(
            "bg-card/95 absolute top-2 left-2 z-10 flex items-center rounded-sm p-0.5 shadow-xs transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
            selected ? "opacity-100" : "opacity-0",
          )}
        >
          <Checkbox
            checked={selected}
            aria-label={`Select ${title}`}
            onClick={(e) => {
              shiftRef.current = e.shiftKey;
            }}
            onCheckedChange={() => onToggle(row.id, shiftRef.current)}
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5 px-2.5 pt-2 pb-2.5">
        <Link
          href={`/media/${row.id}`}
          tabIndex={-1}
          className="truncate text-[13px] font-medium hover:underline"
          title={title}
        >
          {title}
        </Link>
        <div className="text-2xs text-muted-foreground flex items-center justify-between gap-2">
          <span className="tabular shrink-0">
            {formatDimensions(row.width, row.height)} · {formatBytes(row.sizeBytes)}
          </span>
          <span className="truncate">{row.contributorName ?? row.uploadedByName ?? ""}</span>
        </div>
        <div className="text-2xs text-muted-foreground truncate">
          {row.stories.length ? (
            <>
              {row.stories[0].title}
              {row.stories.length > 1 ? ` +${row.stories.length - 1}` : ""}
            </>
          ) : (
            <span className="text-muted-foreground/60">{tr("Not used in a story")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
