"use client";

import { useState } from "react";
import { Building2, GraduationCap, TrendingUp, Users } from "lucide-react";
import { useTranslations } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Who Briefly is for.
 *
 * Four segments, each with the titles that kind of organisation actually publishes. The examples
 * are the point: "companies" means nothing on its own, "an internal newsletter, a recruitment
 * story, a product update" means something to the person reading.
 */

const SEGMENTS = [
  { key: "companies", icon: Building2, titles: ["Acme Inside", "Quarterly Review", "Product Notes"] },
  { key: "schools", icon: GraduationCap, titles: ["Campus Weekly", "Alumni Letter", "The Annual"] },
  { key: "communities", icon: Users, titles: ["Members' Monthly", "Event Recaps", "The Yearbook"] },
  { key: "investors", icon: TrendingUp, titles: ["Portfolio Update", "LP Letter", "Market Notes"] },
] as const;

export function AudienceTabs() {
  const t = useTranslations();
  const [active, setActive] = useState<(typeof SEGMENTS)[number]["key"]>("companies");
  const segment = SEGMENTS.find((s) => s.key === active)!;

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label={t("marketing.audiences.title")}>
        {SEGMENTS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            onClick={() => setActive(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors",
              active === key ? "border-foreground/25 bg-foreground text-background" : "border-border text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(`marketing.audiences.${key}` as "marketing.audiences.companies")}
          </button>
        ))}
      </div>

      <div key={active} className="mx-auto mt-8 max-w-xl text-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
        <p className="text-[16px] leading-7 text-muted-foreground">{t(`marketing.audiences.${active}Body` as "marketing.audiences.companiesBody")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {segment.titles.map((title) => (
            <span key={title} className="rounded-full border border-border bg-card px-3 py-1 text-[13px] text-muted-foreground">
              {title}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
