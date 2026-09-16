import { cn } from "@/lib/utils";

export function CampusChip({ name, colour, className, size = "sm" }: { name: string; colour?: string | null; className?: string; size?: "xs" | "sm" }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-sm border border-border bg-card font-medium whitespace-nowrap", size === "xs" ? "px-1 py-px text-[10px]" : "px-1.5 py-0.5 text-2xs", className)}>
      <span className="size-1.5 rounded-full" style={{ backgroundColor: colour ?? "#2BAFE0" }} />
      {name}
    </span>
  );
}

export function CampusList({ campuses, max = 3 }: { campuses: { name: string; colour?: string | null }[]; max?: number }) {
  if (!campuses.length) return <span className="text-2xs text-muted-foreground">School-wide</span>;
  const shown = campuses.slice(0, max);
  const rest = campuses.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <CampusChip key={c.name} name={c.name} colour={c.colour} size="xs" />
      ))}
      {rest > 0 ? <span className="text-2xs text-muted-foreground">+{rest}</span> : null}
    </span>
  );
}
