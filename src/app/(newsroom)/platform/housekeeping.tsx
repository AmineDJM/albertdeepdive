"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Eraser, Search } from "lucide-react";
import { pruneGroundsAction } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * The one kind of file nothing else cleans up.
 *
 * Two steps on purpose. The check walks the whole bucket against every spec, which is the cost of
 * knowing rather than guessing, and the number it finds is the number the second button removes —
 * no estimate, no "about". Nothing is listed and nothing is deleted by a page load.
 */
export function Housekeeping() {
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState<{ kept: number; removed: number; referenced: number } | null>(null);

  const run = (dryRun: boolean) =>
    startTransition(async () => {
      const result = await pruneGroundsAction(dryRun);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (dryRun) {
        setChecked(result.data);
        return;
      }
      toast.success(result.message ?? "Done");
      setChecked({ ...result.data, removed: 0 });
    });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        Generated grounds are shared between packs and belong to nobody, so deleting a pack never removes one. Check what is left, then remove what no pack names.
        {checked ? (
          <span className="mt-1 block text-foreground">
            {checked.kept + checked.removed} stored · {checked.referenced} named by a pack · {checked.removed} unreferenced and older than a day
          </span>
        ) : null}
      </p>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(true)}>
        <Search /> {pending ? "Checking…" : "Check"}
      </Button>
      {checked?.removed ? (
        <Button size="sm" disabled={pending} onClick={() => run(false)}>
          <Eraser /> Remove {checked.removed}
        </Button>
      ) : null}
    </div>
  );
}
