import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

export function PageHeader({ title, description, actions, breadcrumbs, meta, className, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: Crumb[]; meta?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80", className)}>
      <div className="flex min-h-12 items-center justify-between gap-4 px-5 py-2">
        <div className="min-w-0">
          {breadcrumbs?.length ? (
            <nav className="mb-0.5 flex items-center gap-1 text-2xs text-muted-foreground" aria-label="Breadcrumb">
              {breadcrumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  {c.href ? <Link href={c.href} className="hover:text-foreground">{c.label}</Link> : <span>{c.label}</span>}
                  {i < breadcrumbs.length - 1 ? <ChevronRight className="size-3" /> : null}
                </span>
              ))}
            </nav>
          ) : null}
          <div className="flex items-center gap-2.5">
            <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
            {meta}
          </div>
          {description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex-1 px-5 py-5", className)}>{children}</div>;
}

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-2.5 flex items-center justify-between gap-3", className)}>
      <h2 className="label-caps">{children}</h2>
      {action}
    </div>
  );
}
