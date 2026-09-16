"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MediaView = "grid" | "list";

/** Grid / list switch, synced to `?view=` so it survives refreshes and links. */
export function ViewToggle({ view }: { view: MediaView }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  function set(next: MediaView) {
    const sp = new URLSearchParams(params.toString());
    if (next === "grid") sp.delete("view");
    else sp.set("view", next);
    router.replace(`${pathname}${sp.toString() ? `?${sp.toString()}` : ""}`, { scroll: false });
  }
  return (
    <div
      role="group"
      aria-label="View"
      className="border-border bg-card inline-flex h-8 items-center gap-0.5 rounded-md border p-0.5 shadow-xs"
    >
      <Button
        variant={view === "grid" ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label="Grid view"
        aria-pressed={view === "grid"}
        onClick={() => set("grid")}
      >
        <LayoutGrid />
      </Button>
      <Button
        variant={view === "list" ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label="List view"
        aria-pressed={view === "list"}
        onClick={() => set("list")}
      >
        <List />
      </Button>
    </div>
  );
}
