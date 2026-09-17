"use client";

import { useState } from "react";
import { BookOpen, Globe, Mail, Printer } from "lucide-react";
import { useTranslations } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * One story, shown in four shapes.
 *
 * The claim this section makes — that Briefly *composes* for each medium rather than resizing one
 * design — is only convincing if the four look genuinely different. So these are four small, honest
 * renderings of the same fictional story: an email that leads and summarises, a web page that runs
 * the full text, a magazine spread on a grid, a printed cover.
 *
 * Deliberately drawn in HTML rather than shipped as screenshots: they stay sharp at any density,
 * they weigh nothing, and they follow the page's own theme.
 */

const FORMATS = [
  { key: "email", icon: Mail },
  { key: "web", icon: Globe },
  { key: "magazine", icon: BookOpen },
  { key: "print", icon: Printer },
] as const;

type FormatKey = (typeof FORMATS)[number]["key"];

const ACCENT = "#1F3A5F";

function Rule({ w = "100%", dim = false }: { w?: string; dim?: boolean }) {
  return <span className={cn("block h-[3px] rounded-full", dim ? "bg-foreground/10" : "bg-foreground/20")} style={{ width: w }} />;
}

function EmailPreview({ headline }: { headline: string }) {
  return (
    <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-md border border-border bg-white shadow-sm dark:bg-neutral-950">
      <div className="border-b border-border px-4 py-3 text-center">
        <p className="text-[7px] font-semibold tracking-[0.16em] text-neutral-400 uppercase">Meridian</p>
        <p className="masthead mt-1 text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">Meridian Monthly</p>
      </div>
      <div className="px-4 py-3">
        <div className="h-16 w-full rounded-sm" style={{ background: `linear-gradient(135deg, ${ACCENT}, #3E7CB1)` }} />
        <p className="mt-2.5 text-[8px] font-bold tracking-[0.12em] uppercase" style={{ color: ACCENT }}>
          Expansion
        </p>
        <p className="masthead mt-1 text-[12px] leading-[1.25] font-semibold text-neutral-900 dark:text-neutral-100">{headline}</p>
        <div className="mt-2 space-y-1">
          <Rule w="100%" dim />
          <Rule w="92%" dim />
          <Rule w="64%" dim />
        </div>
        <div className="mt-3 space-y-2 border-t border-border pt-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-2">
              <span className="h-6 w-8 shrink-0 rounded-[2px] bg-foreground/10" />
              <span className="flex-1 space-y-1 pt-0.5">
                <Rule w="88%" />
                <Rule w="60%" dim />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WebPreview({ headline }: { headline: string }) {
  return (
    <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-md border border-border bg-white shadow-sm dark:bg-neutral-950">
      <div className="flex items-center gap-1 border-b border-border bg-foreground/[0.03] px-2.5 py-1.5">
        <span className="size-1.5 rounded-full bg-foreground/15" />
        <span className="size-1.5 rounded-full bg-foreground/15" />
        <span className="size-1.5 rounded-full bg-foreground/15" />
        <span className="ml-2 font-mono text-[6px] text-neutral-400">meridian.co/r/october</span>
      </div>
      <div className="px-8 py-5">
        <p className="text-center text-[7px] font-semibold tracking-[0.16em] text-neutral-400 uppercase">Meridian Monthly</p>
        <p className="mt-1 text-[8px] font-bold tracking-[0.12em] uppercase" style={{ color: ACCENT }}>
          Expansion
        </p>
        <p className="masthead mt-1.5 text-[15px] leading-[1.15] font-semibold text-neutral-900 dark:text-neutral-100">{headline}</p>
        <div className="mt-2 space-y-1">
          <Rule w="100%" dim />
          <Rule w="78%" dim />
        </div>
        <div className="mt-3 h-20 w-full rounded-sm" style={{ background: `linear-gradient(120deg, ${ACCENT}, #3E7CB1)` }} />
        <div className="mt-3 space-y-1.5">
          {["100%", "97%", "99%", "84%", "100%", "62%"].map((w, i) => (
            <Rule key={i} w={w} dim />
          ))}
        </div>
      </div>
    </div>
  );
}

function MagazinePreview({ headline }: { headline: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[400px] overflow-hidden rounded-md border border-border bg-white shadow-sm dark:bg-neutral-950">
      <div className="w-1/2 border-r border-border p-4">
        <div className="h-[86px] w-full rounded-[2px]" style={{ background: `linear-gradient(150deg, ${ACCENT}, #3E7CB1)` }} />
        <p className="mt-2.5 text-[7px] font-bold tracking-[0.14em] uppercase" style={{ color: ACCENT }}>
          Expansion
        </p>
        <p className="masthead mt-1 text-[13px] leading-[1.1] font-semibold text-neutral-900 dark:text-neutral-100">{headline}</p>
        <div className="mt-2 space-y-1">
          <Rule w="100%" dim />
          <Rule w="88%" dim />
        </div>
      </div>
      <div className="w-1/2 p-4">
        <div className="columns-2 gap-2 space-y-1 [column-fill:auto]">
          {["100%", "96%", "100%", "72%", "100%", "94%", "100%", "58%", "100%", "89%", "96%", "44%"].map((w, i) => (
            <Rule key={i} w={w} dim />
          ))}
        </div>
        <div className="mt-2 border-l-2 pl-2" style={{ borderColor: ACCENT }}>
          <Rule w="92%" />
          <span className="mt-1 block" />
          <Rule w="70%" />
        </div>
        <p className="mt-3 text-right font-mono text-[6px] text-neutral-400">14</p>
      </div>
    </div>
  );
}

function PrintPreview({ headline }: { headline: string }) {
  return (
    <div className="mx-auto w-full max-w-[240px]">
      <div className="overflow-hidden rounded-[3px] border border-border bg-white shadow-[0_10px_30px_-10px_rgba(16,16,20,0.35)] dark:bg-neutral-950">
        <div className="relative aspect-[210/297]">
          <div className="absolute inset-0" style={{ background: `linear-gradient(165deg, ${ACCENT} 0%, #12263c 100%)` }} />
          <div className="relative flex h-full flex-col justify-between p-4 text-white">
            <div>
              <p className="text-[7px] font-semibold tracking-[0.2em] uppercase opacity-70">Meridian Monthly</p>
              <p className="mt-0.5 text-[6px] tracking-wide opacity-50">Issue N°12 · October 2026</p>
            </div>
            <div>
              <p className="text-[7px] font-bold tracking-[0.14em] uppercase" style={{ color: "#D4AF37" }}>
                Expansion
              </p>
              <p className="masthead mt-1.5 text-[17px] leading-[1.05] font-semibold">{headline}</p>
              <div className="mt-2 space-y-1 opacity-50">
                <span className="block h-[3px] w-[90%] rounded-full bg-white/50" />
                <span className="block h-[3px] w-[60%] rounded-full bg-white/50" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FormatShowcase() {
  const t = useTranslations();
  const [active, setActive] = useState<FormatKey>("email");
  const headline = t("marketing.formats.story");

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label={t("marketing.formats.title")}>
        {FORMATS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => setActive(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
              active === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(`marketing.formats.${key}` as "marketing.formats.email")}
          </button>
        ))}
      </div>

      <div className="mt-8 flex min-h-[320px] items-center justify-center rounded-xl border border-border bg-gradient-to-b from-foreground/[0.02] to-transparent p-6 sm:p-10">
        <div key={active} className="w-full motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
          {active === "email" ? <EmailPreview headline={headline} /> : null}
          {active === "web" ? <WebPreview headline={headline} /> : null}
          {active === "magazine" ? <MagazinePreview headline={headline} /> : null}
          {active === "print" ? <PrintPreview headline={headline} /> : null}
        </div>
      </div>

      <p className="mx-auto mt-5 max-w-lg text-center text-[14px] leading-6 text-muted-foreground">
        {t(`marketing.formats.${active}Note` as "marketing.formats.emailNote")}
      </p>
    </div>
  );
}
