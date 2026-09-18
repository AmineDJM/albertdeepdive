"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import type { MediaListRow } from "@/server/media/library";
import { MediaCard } from "./media-card";
import { MediaListTable } from "./media-list-table";
import { BulkActionBar } from "./bulk-action-bar";
import { useUi } from "@/components/i18n/provider";

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog], [cmdk-root]"))
    return true;
  return false;
}

/**
 * The library body: thumbnail grid or dense table, multi-selection (click, shift-click, Space,
 * ⌘/Ctrl+A, Escape), arrow-key navigation between cards and the bulk action bar.
 */
export function MediaLibrary({
  rows,
  editionId,
  view,
  canManage,
  canRights,
}: {
  rows: MediaListRow[];
  editionId: string;
  view: "grid" | "list";
  canManage: boolean;
  canRights: boolean;
}) {
  const tr = useUi();
  const [rawSelected, setSelected] = useState<Set<string>>(() => new Set());
  const lastClicked = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const selectable = canManage || canRights;

  // Selections that are no longer on the page (after a refresh, filter or page change) are dropped
  // by deriving the visible selection rather than writing state from an effect.
  const selected = useMemo(() => {
    const visible = new Set([...rawSelected].filter((id) => ids.includes(id)));
    return visible.size === rawSelected.size ? rawSelected : visible;
  }, [rawSelected, ids]);

  const toggle = useCallback(
    (id: string, shift: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const anchor = lastClicked.current;
        if (shift && anchor && anchor !== id) {
          const a = ids.indexOf(anchor);
          const b = ids.indexOf(id);
          if (a >= 0 && b >= 0) {
            const on = !prev.has(id);
            const [from, to] = a < b ? [a, b] : [b, a];
            for (let i = from; i <= to; i++) {
              if (on) next.add(ids[i]);
              else next.delete(ids[i]);
            }
            lastClicked.current = id;
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        lastClicked.current = id;
        return next;
      });
    },
    [ids],
  );

  const toggleAll = useCallback(() => {
    setSelected((prev) => (ids.every((id) => prev.has(id)) ? new Set() : new Set(ids)));
  }, [ids]);

  const clear = useCallback(() => setSelected(new Set()), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && selectable) {
        e.preventDefault();
        setSelected(new Set(ids));
        return;
      }
      if (e.key === "Escape" && selected.size) {
        clear();
        return;
      }
      if (view !== "grid" || !gridRef.current) return;
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      const cards = [
        ...gridRef.current.querySelectorAll<HTMLElement>("[data-media-card] a[href]"),
      ].filter(
        (a, i, arr) =>
          arr.findIndex(
            (x) => x.closest("[data-media-card]") === a.closest("[data-media-card]"),
          ) === i,
      );
      const active = document.activeElement as HTMLElement | null;
      const index = cards.findIndex((c) => c === active);
      if (index < 0) return;
      const columns = Math.max(
        1,
        getComputedStyle(gridRef.current).gridTemplateColumns.split(" ").filter(Boolean).length,
      );
      const delta =
        e.key === "ArrowRight"
          ? 1
          : e.key === "ArrowLeft"
            ? -1
            : e.key === "ArrowDown"
              ? columns
              : -columns;
      const next = cards[index + delta];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ids, selectable, selected.size, clear, view]);

  return (
    <div className="space-y-3">
      {view === "list" ? (
        <MediaListTable
          rows={rows}
          selected={selected}
          selectable={selectable}
          onToggle={toggle}
          onToggleAll={toggleAll}
        />
      ) : (
        <div
          ref={gridRef}
          role="list"
          aria-label={tr("Media assets")}
          className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-3"
        >
          {rows.map((row) => (
            <MediaCard
              key={row.id}
              row={row}
              selected={selected.has(row.id)}
              selectable={selectable}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
      {selectable && !selected.size ? (
        <p className="text-2xs text-muted-foreground hidden items-center gap-1.5 md:flex">
          {tr("Select with the checkbox or")}{" "}<Kbd>{tr("Space")}</Kbd>{tr(", ranges with")}{" "}<Kbd>{tr("Shift")}</Kbd>{tr(", everything with")}{" "}<Kbd>⌘A</Kbd>{tr(", move with the arrow keys, open with")}{" "}<Kbd>{tr("Enter")}</Kbd>.
        </p>
      ) : null}
      {selected.size ? (
        <BulkActionBar
          editionId={editionId}
          ids={[...selected]}
          canManage={canManage}
          canRights={canRights}
          onDone={clear}
        />
      ) : null}
    </div>
  );
}
