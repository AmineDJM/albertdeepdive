"use client";

import type { CampusDTO } from "@/lib/submissions/dto";
import { cn } from "@/lib/utils";

/** Multi-select campus chips; selecting none means the whole school. */
export function CampusChips({ campuses, value, onChange, error }: { campuses: CampusDTO[]; value: string[]; onChange: (value: string[]) => void; error?: string }) {
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  const wholeSchool = value.length === 0;
  const chip = (selected: boolean) =>
    cn(
      "focus-ring inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-medium transition-colors",
      selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:border-primary/50",
    );
  return (
    <div className="space-y-1.5">
      <p className="text-[15px] font-medium">Which campus is this about?</p>
      <div role="group" aria-label="Campuses" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={wholeSchool} onClick={() => onChange([])} className={chip(wholeSchool)}>
          Whole school
        </button>
        {campuses.map((campus) => {
          const selected = value.includes(campus.id);
          return (
            <button key={campus.id} type="button" aria-pressed={selected} onClick={() => toggle(campus.id)} className={chip(selected)}>
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: selected ? "currentColor" : (campus.colour ?? "var(--brand)") }} />
              {campus.name}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-[13px] text-muted-foreground">Pick one or several campuses, or leave &ldquo;Whole school&rdquo; if it concerns everyone.</p>
      )}
    </div>
  );
}
