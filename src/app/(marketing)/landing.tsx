import Link from "next/link";
import { ArrowRight, BookOpen, Check, ClipboardCheck, Globe, Grid2x2, Mail, Palette, PenLine, Printer, Ruler, Send, ShieldCheck, Sparkles } from "lucide-react";
import { BrieflyLogo } from "@/components/brand/briefly-mark";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { FormatShowcase } from "@/components/marketing/format-showcase";
import { AudienceTabs } from "@/components/marketing/audience-tabs";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { PricingTable, type MarketingPlan } from "@/components/marketing/pricing-table";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import type { Translate } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The public landing page.
 *
 * Editorial rather than "SaaS": large type, a lot of air, one idea per screen, and movement only
 * where it explains something. Every claim here is one the product actually keeps today — the
 * social and video work is marked as unbuilt rather than quietly implied, because a pricing page
 * that promises what the software cannot do is the fastest way to lose the first ten customers.
 *
 * There is no social proof on this page. Briefly has no customers to quote yet, and inventing logos
 * or testimonials is not a thing to do.
 */

function Section({ id, children, className, tone = "default" }: { id?: string; children: React.ReactNode; className?: string; tone?: "default" | "muted" | "ink" }) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20 px-5 py-20 sm:px-8 sm:py-28",
        tone === "muted" && "bg-foreground/[0.02]",
        tone === "ink" && "bg-[#101014] text-[#FBFBFA]",
        className,
      )}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Kicker({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "ink" }) {
  return <p className={cn("text-2xs font-medium tracking-[0.14em] uppercase", tone === "ink" ? "text-white/45" : "text-muted-foreground")}>{children}</p>;
}

function Title({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("masthead mt-3 max-w-3xl text-[clamp(28px,4.2vw,44px)] leading-[1.08] font-semibold", className)}>{children}</h2>;
}

function Lede({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-4 max-w-2xl text-[17px] leading-[1.65] text-muted-foreground", className)}>{children}</p>;
}

export function Landing({ plans, signedIn, t }: { plans: MarketingPlan[]; signedIn: boolean; t: Translate }) {
  const steps = [
    { icon: Globe, title: t("marketing.onboarding.step1Title"), body: t("marketing.onboarding.step1Body") },
    { icon: Palette, title: t("marketing.onboarding.step2Title"), body: t("marketing.onboarding.step2Body") },
    { icon: Send, title: t("marketing.onboarding.step3Title"), body: t("marketing.onboarding.step3Body") },
  ];

  const craft = [
    { icon: Ruler, title: t("marketing.design.point1"), body: t("marketing.design.point1Body") },
    { icon: Palette, title: t("marketing.design.point2"), body: t("marketing.design.point2Body") },
    { icon: ShieldCheck, title: t("marketing.design.point3"), body: t("marketing.design.point3Body") },
  ];

  const inbox = [
    { title: t("marketing.brain.item1"), note: t("marketing.brain.item1Note") },
    { title: t("marketing.brain.item2"), note: t("marketing.brain.item2Note") },
    { title: t("marketing.brain.item3"), note: t("marketing.brain.item3Note") },
    { title: t("marketing.brain.item4"), note: t("marketing.brain.item4Note") },
  ];

  const faq = Array.from({ length: 10 }, (_, i) => ({
    q: t(`marketing.faq.q${i + 1}` as "marketing.faq.q1"),
    a: t(`marketing.faq.a${i + 1}` as "marketing.faq.a1"),
  }));

  const control = ["step1", "step2", "step3", "step4"] as const;

  return (
    <div className="min-h-screen bg-background">
      <MarketingHeader signedIn={signedIn} />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-5 pt-14 pb-20 sm:px-8 sm:pt-20 sm:pb-28">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] opacity-[0.07]"
          style={{ background: `radial-gradient(ellipse 60% 100% at 50% 0%, ${BRAND.accent}, transparent 70%)` }}
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-16">
          <div>
            <h1 className="masthead text-[clamp(38px,6.4vw,66px)] leading-[1.02] font-semibold tracking-[-0.03em]">
              {t("marketing.hero.headline")}
              <br />
              <span className="text-muted-foreground">{t("marketing.hero.headlineAccent")}</span>
            </h1>
            <p className="mt-6 max-w-xl text-[18px] leading-[1.6] text-muted-foreground">{t("marketing.hero.body")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link href={signedIn ? "/overview" : "/login?next=%2Fonboarding"}>
                  {t("marketing.hero.cta")} <ArrowRight />
                </Link>
              </Button>
              <Button size="lg" variant="ghost" asChild>
                <a href="#product">{t("marketing.hero.secondary")}</a>
              </Button>
            </div>
            <p className="mt-4 text-[13px] text-muted-foreground">{t("marketing.hero.reassurance")}</p>
          </div>
          <HeroDemo />
        </div>
      </section>

      {/* ── From website to first publication ────────────────────────────── */}
      <Section id="product" tone="muted">
        <Kicker>{t("marketing.onboarding.kicker")}</Kicker>
        <Title>{t("marketing.onboarding.title")}</Title>
        <Lede>{t("marketing.onboarding.body")}</Lede>
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title}>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
                  <step.icon className="size-4" aria-hidden />
                </span>
                <span className="font-mono text-2xs text-muted-foreground">0{i + 1}</span>
              </div>
              <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em]">{step.title}</h3>
              <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── One story, every format ──────────────────────────────────────── */}
      <Section id="examples">
        <div className="text-center">
          <Kicker>{t("marketing.formats.kicker")}</Kicker>
          <Title className="mx-auto text-center">{t("marketing.formats.title")}</Title>
          <Lede className="mx-auto text-center">{t("marketing.formats.body")}</Lede>
        </div>
        <div className="mt-12">
          <FormatShowcase />
        </div>
      </Section>

      {/* ── The edition model ────────────────────────────────────────────── */}
      <Section tone="muted">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Kicker>{t("marketing.edition.kicker")}</Kicker>
            <Title>{t("marketing.edition.title")}</Title>
            <Lede>{t("marketing.edition.body")}</Lede>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="space-y-3">
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="label-caps">{t("marketing.edition.publication")}</p>
                <p className="mt-0.5 text-[14px] font-medium">Meridian Monthly</p>
              </div>
              <div className="ml-5 rounded-lg border border-border px-4 py-3">
                <p className="label-caps">{t("marketing.edition.editionLabel")}</p>
                <p className="mt-0.5 text-[14px] font-medium">October 2026 · Issue N°12</p>
              </div>
              <div className="ml-10">
                <p className="label-caps mb-2">{t("marketing.edition.outputs")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["email", Mail],
                      ["web", Globe],
                      ["magazine", BookOpen],
                      ["print", Printer],
                    ] as const
                  ).map(([key, Icon]) => (
                    <span key={key} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[13px]">
                      <span className="flex size-5 items-center justify-center rounded bg-foreground text-background">
                        <Icon className="size-3" aria-hidden />
                      </span>
                      {t(`marketing.outputs.${key}` as "marketing.outputs.email")}
                      <Check className="ml-auto size-3.5 text-emerald-600" aria-hidden />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Content brain ────────────────────────────────────────────────── */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="order-2 lg:order-1">
            <div className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="label-caps">Inbox</p>
                <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-2xs text-muted-foreground">{t("marketing.brain.flow")}</span>
              </div>
              <ul className="divide-y divide-border">
                {inbox.map((item) => (
                  <li key={item.title} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground/5">
                      <Sparkles className="size-3 text-muted-foreground" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{item.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <Kicker>{t("marketing.brain.kicker")}</Kicker>
            <Title>{t("marketing.brain.title")}</Title>
            <Lede>{t("marketing.brain.body")}</Lede>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px] text-muted-foreground">
              <ClipboardCheck className="size-3.5" aria-hidden /> {t("marketing.brain.note")}
            </p>
          </div>
        </div>
      </Section>

      {/* ── Craft ────────────────────────────────────────────────────────── */}
      <Section tone="ink">
        <Kicker tone="ink">{t("marketing.design.kicker")}</Kicker>
        <h2 className="masthead mt-3 max-w-3xl text-[clamp(28px,4.2vw,44px)] leading-[1.08] font-semibold">{t("marketing.design.title")}</h2>
        <p className="mt-4 max-w-2xl text-[17px] leading-[1.65] text-white/60">{t("marketing.design.body")}</p>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {craft.map((point) => (
            <div key={point.title}>
              <span className="flex size-9 items-center justify-center rounded-lg bg-white/10">
                <point.icon className="size-4" aria-hidden />
              </span>
              <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.01em]">{point.title}</h3>
              <p className="mt-2 text-[14px] leading-6 text-white/55">{point.body}</p>
            </div>
          ))}
        </div>
        <p className="masthead mt-14 max-w-2xl text-[clamp(20px,2.6vw,28px)] leading-[1.25] font-medium text-white/85">{t("marketing.design.statement")}</p>
      </Section>

      {/* ── Print ────────────────────────────────────────────────────────── */}
      <Section>
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Kicker>{t("marketing.print.kicker")}</Kicker>
            <Title>{t("marketing.print.title")}</Title>
            <Lede>{t("marketing.print.body")}</Lede>
            <ul className="mt-6 space-y-2">
              {(["bullet1", "bullet2", "bullet3", "bullet4"] as const).map((key) => (
                <li key={key} className="flex items-start gap-2 text-[14px] leading-6">
                  <Check className="mt-1 size-3.5 shrink-0 text-emerald-600" aria-hidden />
                  <span className="text-muted-foreground">{t(`marketing.print.${key}`)}</span>
                </li>
              ))}
            </ul>
          </div>
          {/* A flatplan: the grid of pages an editor rearranges by hand. Each page carries the shape
              of what is on it, because a grid of empty rectangles says nothing about the product. */}
          <div className="grid w-full grid-cols-6 gap-1.5" aria-hidden>
            {Array.from({ length: 24 }, (_, i) => {
              const kind = i === 0 ? "cover" : i === 23 ? "back" : i % 6 === 1 ? "photo" : i % 5 === 0 ? "opener" : "text";
              return (
                <div key={i} className="flex aspect-[210/297] flex-col justify-between rounded-[2px] border border-border bg-card p-[3px]">
                  <div className="flex flex-1 flex-col gap-[2px] overflow-hidden">
                    {kind === "cover" ? <span className="h-full w-full rounded-[1px]" style={{ background: "linear-gradient(160deg,#1F3A5F,#12263c)" }} /> : null}
                    {kind === "back" ? <span className="h-full w-full rounded-[1px] bg-foreground/10" /> : null}
                    {kind === "photo" ? (
                      <>
                        <span className="h-1/2 w-full rounded-[1px] bg-foreground/15" />
                        <span className="h-[2px] w-[85%] rounded-full bg-foreground/15" />
                        <span className="h-[2px] w-[60%] rounded-full bg-foreground/10" />
                      </>
                    ) : null}
                    {kind === "opener" ? (
                      <>
                        <span className="h-[3px] w-[55%] rounded-full bg-foreground/25" />
                        <span className="mt-[2px] h-[2px] w-[90%] rounded-full bg-foreground/10" />
                        <span className="h-[2px] w-[80%] rounded-full bg-foreground/10" />
                      </>
                    ) : null}
                    {kind === "text"
                      ? Array.from({ length: 7 }, (_, k) => <span key={k} className="h-[2px] rounded-full bg-foreground/10" style={{ width: `${70 + ((i + k) % 4) * 8}%` }} />)
                      : null}
                  </div>
                  <span className="mt-[2px] text-right font-mono text-[4px] leading-none text-muted-foreground">{i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      {/* ── Brand ────────────────────────────────────────────────────────── */}
      <Section tone="muted">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Kicker>{t("marketing.brand.kicker")}</Kicker>
            <Title>{t("marketing.brand.title")}</Title>
            <Lede>{t("marketing.brand.body")}</Lede>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="label-caps">{t("marketing.brand.learns")}</p>
            <ul className="mt-4 space-y-3">
              {(["item1", "item2", "item3", "item4", "item5"] as const).map((key) => (
                <li key={key} className="flex items-center gap-3 text-[14px]">
                  <Grid2x2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">{t(`marketing.brand.${key}`)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2 border-t border-border pt-5">
              {["#1F3A5F", "#3E7CB1", "#D4AF37", "#EFE6D4", "#101014"].map((colour) => (
                <span key={colour} className="h-9 flex-1 rounded-md border border-black/5" style={{ backgroundColor: colour }} />
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Audiences ────────────────────────────────────────────────────── */}
      <Section>
        <div className="text-center">
          <Kicker>{t("marketing.audiences.kicker")}</Kicker>
          <Title className="mx-auto text-center">{t("marketing.audiences.title")}</Title>
        </div>
        <div className="mt-12">
          <AudienceTabs />
        </div>
      </Section>

      {/* ── Control ──────────────────────────────────────────────────────── */}
      <Section tone="muted">
        <div className="text-center">
          <Kicker>{t("marketing.control.kicker")}</Kicker>
          <Title className="mx-auto text-center">{t("marketing.control.title")}</Title>
          <Lede className="mx-auto text-center">{t("marketing.control.body")}</Lede>
        </div>
        <ol className="mx-auto mt-12 flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center">
          {control.map((key, i) => (
            <li key={key} className="flex flex-1 items-center gap-3">
              <span className="flex flex-1 items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-[14px] font-medium">
                <PenLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                {t(`marketing.control.${key}`)}
              </span>
              {i < control.length - 1 ? <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden /> : null}
            </li>
          ))}
        </ol>
      </Section>

      {/* ── What is being built ──────────────────────────────────────────── */}
      <Section>
        <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/5 px-3 py-1 text-2xs font-medium tracking-[0.1em] text-muted-foreground uppercase">
            {t("marketing.creative.badge")}
          </span>
          <h2 className="masthead mt-4 text-[clamp(22px,3vw,30px)] leading-[1.15] font-semibold">{t("marketing.creative.title")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">{t("marketing.creative.body")}</p>
        </div>
      </Section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <Section id="pricing" tone="muted">
        <div className="text-center">
          <Kicker>{t("marketing.pricing.kicker")}</Kicker>
          <Title className="mx-auto text-center">{t("marketing.pricing.title")}</Title>
          <Lede className="mx-auto text-center">{t("marketing.pricing.body")}</Lede>
        </div>
        <div className="mt-12">
          <PricingTable plans={plans} />
        </div>
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <Section>
        <Title>{t("marketing.faq.title")}</Title>
        <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {faq.map((item) => (
            <div key={item.q}>
              <dt className="text-[15px] font-semibold tracking-[-0.01em]">{item.q}</dt>
              <dd className="mt-2 text-[14px] leading-6 text-muted-foreground">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* ── Final call ───────────────────────────────────────────────────── */}
      <Section tone="ink" className="text-center">
        <h2 className="masthead mx-auto max-w-3xl text-[clamp(30px,5vw,52px)] leading-[1.05] font-semibold">
          {t("marketing.finalCta.title")}
          <br />
          <span className="text-white/50">{t("marketing.finalCta.titleAccent")}</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] leading-7 text-white/60">{t("marketing.finalCta.body")}</p>
        <div className="mt-9 flex justify-center">
          <Button size="lg" asChild className="bg-white text-[#101014] hover:bg-white/90">
            <Link href={signedIn ? "/overview" : "/login?next=%2Fonboarding"}>
              {t("marketing.finalCta.cta")} <ArrowRight />
            </Link>
          </Button>
        </div>
      </Section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-2">
            <BrieflyLogo height={20} />
          </Link>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground" aria-label={BRAND.name}>
            <a href="#product" className="hover:text-foreground">
              {t("marketing.footer.product")}
            </a>
            <Link href="/collections" className="hover:text-foreground">
              {t("marketing.footer.collections")}
            </Link>
            <a href="#pricing" className="hover:text-foreground">
              {t("marketing.footer.pricing")}
            </a>
            <Link href="/login" className="hover:text-foreground">
              {t("marketing.footer.logIn")}
            </Link>
            <a href="mailto:hello@briefly.press" className="hover:text-foreground">
              {t("marketing.footer.contact")}
            </a>
          </nav>
          <p className="text-2xs text-muted-foreground">
            © {new Date().getFullYear()} {BRAND.name}. {t("marketing.footer.rights")}
          </p>
        </div>
      </footer>
    </div>
  );
}
