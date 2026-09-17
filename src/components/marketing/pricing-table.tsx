"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "@/components/i18n/provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MarketingPlan = {
  key: string;
  name: string;
  tagline: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  highlights: string[];
  isFeatured: boolean;
  isCustomPriced: boolean;
  isFree: boolean;
};

/**
 * The public pricing table.
 *
 * Every figure comes from the same `plans` rows the product enforces its limits from, so a price
 * changed in the super-admin console is the price a visitor sees. There is no second copy of the
 * pricing to drift out of step with the first.
 */
export function PricingTable({ plans }: { plans: MarketingPlan[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const [interval, setInterval] = useState<"month" | "year">("month");

  const money = (cents: number, currency: string) =>
    new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

  return (
    <div>
      <div className="flex justify-center">
        <div className="inline-flex rounded-full border border-border bg-card p-0.5" role="group" aria-label={t("marketing.pricing.kicker")}>
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              aria-pressed={interval === value}
              className={cn(
                "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors",
                interval === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "month" ? t("marketing.pricing.monthly") : t("marketing.pricing.yearly")}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-4">
        {plans.map((plan) => {
          const total = interval === "year" ? plan.priceYearlyCents : plan.priceMonthlyCents;
          const perMonth = interval === "year" ? Math.round(plan.priceYearlyCents / 12) : plan.priceMonthlyCents;
          const saving = plan.priceMonthlyCents > 0 && plan.priceYearlyCents > 0 ? Math.round(100 - (plan.priceYearlyCents / (plan.priceMonthlyCents * 12)) * 100) : 0;

          return (
            <div
              key={plan.key}
              className={cn(
                "relative flex flex-col rounded-2xl border p-6",
                plan.isFeatured ? "border-foreground/25 bg-card shadow-[0_1px_2px_rgba(16,16,20,0.04),0_20px_50px_-24px_rgba(16,16,20,0.3)]" : "border-border bg-card/60",
              )}
            >
              {plan.isFeatured ? (
                <span className="absolute -top-2.5 left-6 rounded-full bg-foreground px-2.5 py-0.5 text-2xs font-medium text-background">{t("marketing.pricing.popular")}</span>
              ) : null}

              <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{plan.name}</h3>
              {plan.tagline ? <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{plan.tagline}</p> : null}

              <div className="mt-5 min-h-[58px]">
                {plan.isCustomPriced ? (
                  <p className="text-[28px] leading-none font-semibold tracking-[-0.03em]">{t("marketing.pricing.custom")}</p>
                ) : (
                  <>
                    <p className="text-[32px] leading-none font-semibold tracking-[-0.03em]">
                      {money(perMonth, plan.currency)}
                      <span className="ml-1 text-[13px] font-normal tracking-normal text-muted-foreground">{t("marketing.pricing.perMonth")}</span>
                    </p>
                    {interval === "year" && total > 0 ? (
                      <p className="mt-1.5 text-2xs text-muted-foreground">
                        {t("marketing.pricing.billedYearly", { total: money(total, plan.currency) })}
                        {saving > 0 ? ` · ${t("marketing.pricing.saveWith", { percent: saving })}` : ""}
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              <ul className="mt-5 flex-1 space-y-2">
                {plan.highlights.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[13px] leading-5">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
                    <span className="text-muted-foreground">{line}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-6">
                {plan.isCustomPriced ? (
                  <Button variant="outline" className="w-full" asChild>
                    <a href="mailto:sales@briefly.press?subject=Briefly%20Enterprise">{t("marketing.pricing.contact")}</a>
                  </Button>
                ) : (
                  <Button variant={plan.isFeatured ? "default" : "outline"} className="w-full" asChild>
                    <Link href={`/login?next=${encodeURIComponent(`/onboarding?plan=${plan.key}`)}`}>
                      {plan.isFree ? t("marketing.pricing.startFree") : t("marketing.pricing.choose", { plan: plan.name })}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">{t("marketing.pricing.note")}</p>
    </div>
  );
}
