import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { cn } from "@/lib/utils";

/** Outer frame of every public page: paper background, centred column, masthead. */
export function PublicShell({ children, editionLabel, className }: { children: ReactNode; editionLabel?: string | null; className?: string }) {
  return (
    <div className={cn("flex min-h-full flex-1 flex-col bg-background text-[15px] leading-6 text-foreground", className)}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-6 pb-28 sm:px-6 sm:pt-10 sm:pb-16">
        <header className="mb-6 flex items-center gap-3">
          <BrandMark size={30} />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="masthead text-xl font-semibold text-primary">Albert&rsquo;s Deep Dive</span>
            {editionLabel ? <span className="label-caps text-brand-foreground/70">· {editionLabel}</span> : null}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

export function StatusScreen({ kicker, title, children, actions }: { kicker?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-xs sm:p-8" aria-live="polite">
      {kicker ? <p className="label-caps mb-2 text-brand-foreground/70">{kicker}</p> : null}
      <h1 className="font-display text-[28px] leading-[1.15] font-semibold tracking-tight text-primary sm:text-[32px]">{title}</h1>
      {children ? <div className="mt-4 space-y-3 text-muted-foreground">{children}</div> : null}
      {actions ? <div className="mt-6 flex flex-wrap gap-3">{actions}</div> : null}
    </section>
  );
}

export function ContactLine({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <p>
      Questions? Write to{" "}
      <a className="font-medium text-primary underline underline-offset-4" href={`mailto:${email}`}>
        {email}
      </a>
      .
    </p>
  );
}

export function InvalidLinkScreen() {
  return (
    <PublicShell>
      <StatusScreen kicker="Personal link" title="This link is not valid">
        <p>Personal links are unique to each contributor. Check that the whole link was copied from your invitation email, or ask the newsroom for a new one.</p>
      </StatusScreen>
    </PublicShell>
  );
}
