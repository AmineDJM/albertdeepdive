"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useUi } from "@/components/i18n/provider";

/**
 * Picking several rows at once.
 *
 * A list that can only act on one row at a time makes "delete these twelve" a twelve-step job, and
 * a person doing it stops at nine. The selection lives here, in the browser; what may be done to
 * it comes from each page, because what may be done to twelve editions is not what may be done to
 * twelve contributors. The boxes are buttons, so the row-link behaviour already ignores them.
 */
type Selection = {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const value = useMemo(() => ({ selected, toggle, setMany, clear }), [selected, toggle, setMany, clear]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): Selection {
  const context = useContext(SelectionContext);
  if (!context) throw new Error("useSelection needs a SelectionProvider above it");
  return context;
}

export function SelectRow({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection();
  return <Checkbox aria-label={`Select ${label}`} checked={selected.has(id)} onCheckedChange={() => toggle(id)} />;
}

export function SelectAll({ ids }: { ids: string[] }) {
  const tr = useUi();
  const { selected, setMany } = useSelection();
  const count = ids.filter((id) => selected.has(id)).length;
  const state = count === 0 ? false : count === ids.length ? true : "indeterminate";
  return <Checkbox aria-label={tr("Select all")} checked={state} disabled={!ids.length} onCheckedChange={() => setMany(ids, state !== true)} />;
}

/**
 * The bar that appears once something is picked. The buttons in it are the page's own; it only
 * says how many, and offers the way out.
 */
export function SelectionBar({ noun, children }: { noun: { one: string; other: string }; children: React.ReactNode }) {
  const tr = useUi();
  const { selected, clear } = useSelection();
  if (!selected.size) return null;
  return (
    <div role="region" aria-label={tr("Selection")} className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      <span className="text-xs font-medium">
        {selected.size} {selected.size === 1 ? noun.one : noun.other} {" "}{tr("selected")}</span>
      <span className="flex-1" />
      {children}
      <Button variant="ghost" size="icon-sm" aria-label={tr("Clear selection")} onClick={clear}>
        <X />
      </Button>
    </div>
  );
}
