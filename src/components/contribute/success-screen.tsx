"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SuccessScreen({
  firstName,
  editionLabel,
  submittedCount,
  closesLabel,
  onAnother,
  busy,
}: {
  firstName: string;
  editionLabel: string;
  submittedCount: number;
  closesLabel: string;
  onAnother: () => void;
  busy?: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-xs sm:p-8" aria-live="polite">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
        <Check className="size-6" strokeWidth={2.5} />
      </span>
      <p className="label-caps mb-2 text-brand-foreground/70">Albert&rsquo;s Deep Dive · {editionLabel}</p>
      <h1 className="font-display text-[30px] leading-[1.1] font-semibold tracking-tight text-primary sm:text-[36px]">
        Thank you, {firstName}. <span className="text-brand-foreground/90">Your story is in the newsroom.</span>
      </h1>
      <div className="mt-6 space-y-3 text-muted-foreground">
        <p className="text-[15px] font-medium text-foreground">What happens next</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>The newsroom reads it, groups it with related submissions and checks names, dates and figures.</li>
          <li>If something is missing, an editor may email you a short question.</li>
          <li>Your story may become an article, a brief or a photo caption in the {editionLabel} issue.</li>
        </ol>
        <p className="text-[13px]">
          {submittedCount > 1 ? `You have sent ${submittedCount} stories this month. ` : ""}
          Contributions stay open until {closesLabel} — you can use the same link again.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button type="button" size="lg" className="h-11 px-5 text-[15px]" onClick={onAnother} loading={busy}>
          Submit another story
        </Button>
      </div>
    </section>
  );
}
