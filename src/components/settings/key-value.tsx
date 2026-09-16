import { cn } from "@/lib/utils";

export type KeyValueRow = { label: React.ReactNode; value: React.ReactNode; mono?: boolean };

/** Compact definition list used for read-only facts (environment, email metadata, job details). */
export function KeyValueList({ rows, className, columns = 1 }: { rows: KeyValueRow[]; className?: string; columns?: 1 | 2 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-1.5 text-[13px]", columns === 2 && "sm:grid-cols-2", className)}>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(96px,140px)_minmax(0,1fr)] items-baseline gap-3 border-b border-border/60 py-1 last:border-0">
          <dt className="label-caps truncate">{row.label}</dt>
          <dd className={cn("min-w-0 break-words", row.mono && "font-mono text-xs")}>{row.value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SettingsCard({ title, description, children, action, className, id }: { title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-16 rounded-lg border border-border bg-card shadow-xs", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

export function FieldError({ errors, name }: { errors?: Record<string, string[]> | null; name: string }) {
  const list = errors?.[name];
  if (!list?.length) return null;
  return (
    <p className="text-2xs text-destructive" role="alert">
      {list.join(" · ")}
    </p>
  );
}
