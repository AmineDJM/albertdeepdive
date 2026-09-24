"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

type Result = { ok: boolean; error?: string };

/**
 * A name that can be changed where it is read.
 *
 * Renaming a newsletter meant finding the pencil in a table on another page, and an edition could
 * not be renamed at all. The name is now its own control: click it (or the pencil), type, Enter.
 * Escape puts it back. Nothing else on the page moves.
 */
export function InlineRename({ value, onSave, label, className, disabled = false, maxLength = 120 }: { value: string; onSave: (next: string) => Promise<Result>; label: string; className?: string; disabled?: boolean; maxLength?: number }) {
  const tr = useUi();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  function save() {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    start(async () => {
      const result = await onSave(next);
      if (!result.ok) {
        toast.error(result.error ?? tr("That did not work"));
        return;
      }
      toast.success(tr("Renamed"));
      setEditing(false);
      router.refresh();
    });
  }

  if (disabled) return <span className={className}>{value}</span>;

  if (!editing)
    return (
      <button type="button" onClick={() => { setDraft(value); setEditing(true); }} aria-label={label} title={label} className={cn("group inline-flex min-w-0 items-center gap-1.5 rounded-md text-left transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", className)}>
        <span className="truncate">{value}</span>
        <Pencil className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" aria-hidden />
      </button>
    );

  return (
    <form
      className="inline-flex min-w-0 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <input
        ref={input}
        value={draft}
        maxLength={maxLength}
        disabled={pending}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setEditing(false);
            setDraft(value);
          }
        }}
        className={cn("min-w-0 rounded-md border border-ring/40 bg-background px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-ring/40", className)}
        style={{ width: `${Math.max(8, draft.length + 2)}ch` }}
      />
      <button type="submit" disabled={pending} aria-label={tr("Save")} className="flex size-7 items-center justify-center rounded-md text-success hover:bg-success-soft">
        <Check className="size-4" />
      </button>
      <button type="button" disabled={pending} aria-label={tr("Cancel")} onClick={() => { setEditing(false); setDraft(value); }} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
        <X className="size-4" />
      </button>
    </form>
  );
}
