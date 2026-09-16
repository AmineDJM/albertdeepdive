"use client";

import Link from "next/link";
import { ImageOff } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RightsBadge } from "@/components/newsroom/status-badge";
import { cn, formatDate } from "@/lib/utils";
import type { MediaListRow } from "@/server/media/library";
import {
  formatBytes,
  formatDimensions,
  KIND_LABELS,
  qualityTone,
  type MediaKind,
} from "@/server/media/constants";

const toneClass = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
} as const;

export function MediaListTable({
  rows,
  selected,
  selectable,
  onToggle,
  onToggleAll,
}: {
  rows: MediaListRow[];
  selected: Set<string>;
  selectable: boolean;
  onToggle: (id: string, shift: boolean) => void;
  onToggleAll: () => void;
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {selectable ? (
              <TableHead className="w-8" data-no-row-link>
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={onToggleAll}
                  aria-label="Select all assets on this page"
                />
              </TableHead>
            ) : null}
            <TableHead className="w-12" />
            <TableHead>Asset</TableHead>
            <TableHead>Rights</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">Quality</TableHead>
            <TableHead>Used in</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const title = r.caption || r.fileName;
            const isSelected = selected.has(r.id);
            return (
              <TableRow
                key={r.id}
                data-href={`/media/${r.id}`}
                data-state={isSelected ? "selected" : undefined}
                className="cursor-pointer"
              >
                {selectable ? (
                  <TableCell className="py-1.5" data-no-row-link>
                    <Checkbox
                      checked={isSelected}
                      aria-label={`Select ${title}`}
                      onClick={(e) => onToggle(r.id, e.shiftKey)}
                      onCheckedChange={() => undefined}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="py-1.5">
                  <div className="bg-muted size-9 overflow-hidden rounded">
                    {r.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.thumbUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className={cn(
                          "size-full object-cover",
                          r.isArchived && "opacity-60 grayscale",
                        )}
                      />
                    ) : (
                      <div className="text-muted-foreground flex size-full items-center justify-center">
                        <ImageOff className="size-3.5" />
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="max-w-[340px] min-w-0">
                    <Link
                      href={`/media/${r.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {title}
                    </Link>
                    <div className="text-2xs text-muted-foreground truncate">
                      {r.fileName} · {formatDimensions(r.width, r.height)}
                      {r.duplicateOfId ? " · duplicate" : ""}
                      {r.isArchived ? " · archived" : ""}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-1.5">
                  <RightsBadge status={r.rightsStatus} />
                </TableCell>
                <TableCell className="py-1.5 text-xs">
                  {KIND_LABELS[r.kind as MediaKind] ?? r.kind}
                </TableCell>
                <TableCell className="tabular py-1.5 text-right text-xs">
                  {formatBytes(r.sizeBytes)}
                </TableCell>
                <TableCell
                  className={cn(
                    "tabular py-1.5 text-right text-xs font-medium",
                    toneClass[qualityTone(r.qualityScore)],
                  )}
                >
                  {r.qualityScore ?? "—"}
                </TableCell>
                <TableCell className="py-1.5">
                  {r.stories.length ? (
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {r.stories.slice(0, 2).map((st) => (
                        <Badge
                          key={st.id}
                          variant="outline"
                          className="max-w-[180px]"
                          title={`${st.title} (${st.role})`}
                        >
                          <span className="truncate">{st.title}</span>
                        </Badge>
                      ))}
                      {r.stories.length > 2 ? (
                        <span className="text-2xs text-muted-foreground">
                          +{r.stories.length - 2}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-2xs text-muted-foreground/70">—</span>
                  )}
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="max-w-[200px] truncate text-xs">
                    {r.contributorName ?? r.uploadedByName ?? "—"}
                  </div>
                  {r.submissionTitle ? (
                    <div className="text-2xs text-muted-foreground max-w-[200px] truncate">
                      {r.submissionTitle}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground py-1.5 text-xs">
                  {formatDate(r.createdAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
