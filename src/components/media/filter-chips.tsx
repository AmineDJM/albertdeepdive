"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Archive, Copy, Unlink } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { useUi } from "@/components/i18n/provider";

const CHIPS = [
  {
    key: "duplicates",
    value: "only",
    label: "Duplicates",
    icon: Copy,
    title: "Only assets in a duplicate or similarity group",
  },
  {
    key: "unused",
    value: "true",
    label: "Unused",
    icon: Unlink,
    title: "Assets not linked to any story, Business Deep Dive or cover",
  },
  {
    key: "archived",
    value: "true",
    label: "Archived",
    icon: Archive,
    title: "Show archived assets instead of active ones",
  },
] as const;

/** URL-synced boolean filters rendered as toggles inside the FilterBar. */
export function FilterChips() {
  const tr = useUi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  function toggle(key: string, value: string, on: boolean) {
    const sp = new URLSearchParams(params.toString());
    if (on) sp.set(key, value);
    else sp.delete(key);
    sp.delete("page");
    startTransition(() =>
      router.replace(`${pathname}${sp.toString() ? `?${sp.toString()}` : ""}`, { scroll: false }),
    );
  }
  return (
    <div className="flex items-center gap-1" role="group" aria-label={tr("Quick filters")}>
      {CHIPS.map((c) => {
        const on = params.get(c.key) === c.value;
        return (
          <Toggle
            key={c.key}
            size="sm"
            variant="outline"
            pressed={on}
            onPressedChange={(v) => toggle(c.key, c.value, v)}
            aria-label={c.label}
            title={c.title}
            className="data-[state=on]:border-brand data-[state=on]:bg-brand-soft data-[state=on]:text-brand-foreground h-8 gap-1 text-xs"
          >
            <c.icon className="size-3.5" />
            {c.label}
          </Toggle>
        );
      })}
    </div>
  );
}
