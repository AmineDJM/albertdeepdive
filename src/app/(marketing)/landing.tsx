import Link from "next/link";
import { ArrowRight, BookOpen, Check, ClipboardCheck, Globe, Mail, Palette, Plus, Printer, Send, Sparkles } from "lucide-react";
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
 * Apple's way of saying a thing: one idea per screen, very large type, a great deal of air, and
 * the product itself as the picture. Colour is Google's four, used once per screen at most — on a
 * word, a dot, a wash behind a card — so the page reads bright rather than busy.
 *
 * Every claim here is one the product actually keeps today — the social and video work is marked
 * as unbuilt rather than quietly implied. There is no social proof on this page: Briefly has no
 * customers to quote yet, and inventing logos or testimonials is not a thing to do.
 */

function Section({ id, children, className, tone = "default" }: { id?: string; children: React.ReactNode; className?: string; tone?: "default" | "muted" }) {
  return (
    <section id={id} className={cn("scroll-mt-20 px-5 py-20 sm:px-8 sm:py-32", tone === "muted" && "bg-[#F5F5F7] dark:bg-card/40", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[15px] font-semibold tracking-[-0.01em] text-brand", className)}>{children}</p>;
}

function Title({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("masthead mt-2 max-w-3xl text-[clamp(32px,5vw,56px)] leading-[1.05]", className)}>{children}</h2>;
}

function Lede({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("mt-5 max-w-2xl text-[19px] leading-[1.55] tracking-[-0.01em] text-muted-foreground", className)}>{children}</p>;
}

/** A tile of the bento grid: white on the grey page, very round, a soft wash of one colour in a corner. */
function Tile({ children, className, wash }: { children: React.ReactNode; className?: string; wash?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[28px] bg-card p-7 shadow-[var(--shadow-soft)] sm:p-9", className)}>
      {wash ? <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full opacity-[0.16] blur-3xl" style={{ background: wash }} /> : null}
      <div className="relative">{children}</div>
    </div>
  );
}

function TileTitle({ kicker, title, body }: { kicker: string; title: string; body?: string }) {
  return (
    <>
      <p className="text-[13px] font-semibold text-muted-foreground">{kicker}</p>
      <h3 className="masthead mt-1.5 text-[clamp(22px,2.4vw,28px)] leading-[1.12]">{title}</h3>
      {body ? <p className="mt-3 max-w-md text-[15px] leading-[1.55] text-muted-foreground">{body}</p> : null}
    </>
  );
}

const G = { blue: "#4285F4", red: "#EA4335", yellow: "#FBBC04", green: "#34A853" } as const;

export function Landing({ plans, signedIn, t }: { plans: MarketingPlan[]; signedIn: boolean; t: Translate }) {
  const steps = [
    { icon: Globe, colour: G.blue, title: t("marketing.onboarding.step1Title"), body: t("marketing.onboarding.step1Body") },
    { icon: Palette, colour: G.red, title: t("marketing.onboarding.step2Title"), body: t("marketing.onboarding.step2Body") },
    { icon: Send, colour: G.green, title: t("marketing.onboarding.step3Title"), body: t("marketing.onboarding.step3Body") },
  ];

  const inbox = [
    { title: t("marketing.brain.item1"), note: t("marketing.brain.item1Note"), colour: G.blue },
    { title: t("marketing.brain.item2"), note: t("marketing.brain.item2Note"), colour: G.green },
    { title: t("marketing.brain.item3"), note: t("marketing.brain.item3Note"), colour: G.yellow },
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
      <section className="relative overflow-hidden px-5 pt-16 pb-20 sm:px-8 sm:pt-24 sm:pb-28">
        {/* The four colours as light, not as paint: a glow far behind the headline. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-[520px] max-w-5xl opacity-[0.22] blur-[90px] dark:opacity-[0.16]" style={{ background: `radial-gradient(40% 55% at 22% 45%, ${G.blue}, transparent 70%), radial-gradient(35% 50% at 48% 30%, ${G.red}, transparent 70%), radial-gradient(35% 50% at 70% 50%, ${G.yellow}, transparent 70%), radial-gradient(35% 50% at 84% 32%, ${G.green}, transparent 70%)` }} />
        <div className="relative mx-auto max-w-4xl text-center">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground shadow-[var(--shadow-soft)] backdrop-blur">
            <span className="flex gap-0.5" aria-hidden>
              {Object.values(G).map((colour) => (
                <span key={colour} className="size-1.5 rounded-full" style={{ background: colour }} />
              ))}
            </span>
            {t("marketing.hero.eyebrow")}
          </p>
          <h1 className="masthead mt-7 text-[clamp(44px,8.4vw,92px)] leading-[0.98]">
            {t("marketing.hero.headline")}
            <br />
            <span className="text-spectrum">{t("marketing.hero.headlineAccent")}</span>
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-[clamp(17px,2vw,21px)] leading-[1.5] tracking-[-0.01em] text-muted-foreground">{t("marketing.hero.body")}</p>
          {signedIn ? (
            <div className="mt-9 flex justify-center">
              <Button size="lg" asChild>
                <Link href="/overview">
                  {t("marketing.hero.openApp")} <ArrowRight />
                </Link>
              </Button>
            </div>
          ) : (
            /* The real first step, not a picture of it: the address goes with you to sign-up and is
               waiting in the onboarding field. */
            <form action="/signup" method="get" className="mx-auto mt-9 flex max-w-md items-center gap-1.5 rounded-full border border-border bg-card p-1.5 pl-5 shadow-[var(--shadow-float)] focus-within:ring-2 focus-within:ring-ring/40" data-testid="hero-website">
              <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <label htmlFor="hero-website" className="sr-only">{t("marketing.hero.websiteLabel")}</label>
              <input id="hero-website" name="website" type="text" inputMode="url" autoComplete="url" placeholder={t("marketing.hero.demoPlaceholder")} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70" />
              <Button type="submit" size="lg" className="h-10 shrink-0">
                {t("marketing.hero.cta")} <ArrowRight />
              </Button>
            </form>
          )}
          <p className="mt-4 text-[13px] text-muted-foreground">
            {t("marketing.hero.reassurance")}{" "}
            <a href="#product" className="font-medium text-brand hover:underline">
              {t("marketing.hero.secondary")} ›
            </a>
          </p>
        </div>
        <div className="relative mx-auto mt-16 max-w-3xl">
          <div className="rounded-[32px] border border-border/70 bg-card/70 p-3 shadow-[var(--shadow-float)] backdrop-blur sm:p-4">
            <HeroDemo />
          </div>
        </div>
      </section>

      {/* ── From website to first publication ────────────────────────────── */}
      <Section id="product" tone="muted">
        <div className="text-center">
          <Kicker>{t("marketing.onboarding.kicker")}</Kicker>
          <Title className="mx-auto">{t("marketing.onboarding.title")}</Title>
          <Lede className="mx-auto">{t("marketing.onboarding.body")}</Lede>
        </div>
        <ol className="mt-14 grid gap-4 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="rounded-[28px] bg-card p-7 shadow-[var(--shadow-soft)]">
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-2xl" style={{ background: `color-mix(in oklch, ${step.colour} 14%, white)`, color: step.colour }}>
                  <step.icon className="size-5" aria-hidden />
                </span>
                <span className="text-[13px] font-medium text-muted-foreground tabular-nums">0{i + 1}</span>
              </div>
              <h3 className="mt-6 text-[19px] font-semibold tracking-[-0.02em]">{step.title}</h3>
              <p className="mt-2 text-[15px] leading-[1.55] text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── One story, every format ──────────────────────────────────────── */}
      <Section id="examples">
        <div className="text-center">
          <Kicker>{t("marketing.formats.kicker")}</Kicker>
          <Title className="mx-auto">{t("marketing.formats.title")}</Title>
          <Lede className="mx-auto">{t("marketing.formats.body")}</Lede>
        </div>
        <div className="mt-14">
          <FormatShowcase />
        </div>
      </Section>

      {/* ── The product, as a bento ──────────────────────────────────────── */}
      <Section tone="muted">
        <div className="text-center">
          <Kicker>{t("marketing.bento.kicker")}</Kicker>
          <Title className="mx-auto">{t("marketing.bento.title")}</Title>
        </div>
        <div className="mt-14 grid gap-4 lg:grid-cols-6">
          {/* Content: what came in, already sorted. */}
          <Tile className="lg:col-span-4" wash={G.blue}>
            <TileTitle kicker={t("marketing.brain.kicker")} title={t("marketing.brain.title")} body={t("marketing.brain.body")} />
            <ul className="mt-7 space-y-2">
              {inbox.map((item) => (
                <li key={item.title} className="flex items-center gap-3 rounded-2xl bg-muted/70 px-4 py-3">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: item.colour }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{item.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.note}</span>
                  </span>
                  <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </li>
              ))}
            </ul>
            <p className="mt-5 inline-flex items-center gap-2 text-[13px] text-muted-foreground">
              <ClipboardCheck className="size-3.5" aria-hidden /> {t("marketing.brain.note")}
            </p>
          </Tile>

          {/* Brand: read off the website. */}
          <Tile className="lg:col-span-2" wash={G.red}>
            <TileTitle kicker={t("marketing.brand.kicker")} title={t("marketing.brand.title")} />
            <div className="mt-7 flex gap-2">
              {["#1F3A5F", "#3E7CB1", "#D4AF37", "#EFE6D4"].map((colour) => (
                <span key={colour} className="h-14 flex-1 rounded-2xl ring-1 ring-black/5" style={{ backgroundColor: colour }} />
              ))}
            </div>
            <ul className="mt-6 space-y-2">
              {(["item1", "item2", "item3", "item5"] as const).map((key) => (
                <li key={key} className="flex items-center gap-2.5 text-[14px] text-muted-foreground">
                  <Check className="size-3.5 shrink-0 text-success" aria-hidden />
                  {t(`marketing.brand.${key}`)}
                </li>
              ))}
            </ul>
          </Tile>

          {/* One edition, where it lives. */}
          <Tile className="lg:col-span-3" wash={G.green}>
            <TileTitle kicker={t("marketing.edition.kicker")} title={t("marketing.edition.title")} />
            <div className="mt-7 grid grid-cols-2 gap-2">
              {(
                [
                  ["email", Mail, G.blue],
                  ["web", Globe, G.green],
                  ["magazine", BookOpen, G.red],
                  ["print", Printer, G.yellow],
                ] as const
              ).map(([key, Icon, colour]) => (
                <span key={key} className="flex items-center gap-2.5 rounded-2xl bg-muted/70 px-4 py-3 text-[14px] font-medium">
                  <Icon className="size-4" style={{ color: colour }} aria-hidden />
                  {t(`marketing.outputs.${key}` as "marketing.outputs.email")}
                  <Check className="ml-auto size-3.5 text-success" aria-hidden />
                </span>
              ))}
            </div>
          </Tile>

          {/* Craft and print. */}
          <Tile className="lg:col-span-3" wash={G.yellow}>
            <TileTitle kicker={t("marketing.design.kicker")} title={t("marketing.design.title")} body={t("marketing.design.point1Body")} />
            <p className="mt-5 flex flex-wrap gap-2">
              {(["bullet1", "bullet3", "bullet4"] as const).map((key) => (
                <span key={key} className="rounded-full bg-muted/70 px-3 py-1.5 text-[13px] text-muted-foreground">
                  {t(`marketing.print.${key}`)}
                </span>
              ))}
            </p>
          </Tile>

          {/* Control: Briefly drafts, you decide. */}
          <Tile className="lg:col-span-6">
            <div className="grid items-center gap-8 lg:grid-cols-2">
              <div>
                <TileTitle kicker={t("marketing.control.kicker")} title={t("marketing.control.title")} body={t("marketing.control.body")} />
              </div>
              <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {control.map((key, i) => (
                  <li key={key} className="rounded-2xl bg-muted/70 px-4 py-4">
                    <span className="flex size-6 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ background: Object.values(G)[i] }}>
                      {i + 1}
                    </span>
                    <span className="mt-3 block text-[14px] font-medium">{t(`marketing.control.${key}`)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Tile>
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-6 text-muted-foreground">
          <span className="mr-2 rounded-full bg-card px-2.5 py-1 font-medium shadow-[var(--shadow-soft)]">{t("marketing.creative.badge")}</span>
          {t("marketing.creative.title")}
        </p>
      </Section>

      {/* ── Audiences ────────────────────────────────────────────────────── */}
      <Section>
        <div className="text-center">
          <Kicker>{t("marketing.audiences.kicker")}</Kicker>
          <Title className="mx-auto">{t("marketing.audiences.title")}</Title>
        </div>
        <div className="mt-14">
          <AudienceTabs />
        </div>
      </Section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <Section id="pricing" tone="muted">
        <div className="text-center">
          <Kicker>{t("marketing.pricing.kicker")}</Kicker>
          <Title className="mx-auto">{t("marketing.pricing.title")}</Title>
          <Lede className="mx-auto">{t("marketing.pricing.body")}</Lede>
        </div>
        <div className="mt-14">
          <PricingTable plans={plans} />
        </div>
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <Title className="text-center">{t("marketing.faq.title")}</Title>
          <div className="mt-10 divide-y divide-border border-y border-border">
            {faq.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold tracking-[-0.015em] [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <Plus className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45" aria-hidden />
                </summary>
                <p className="mt-3 pr-8 text-[15px] leading-[1.6] text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Final call ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-5 py-24 text-center sm:px-8 sm:py-36">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[-220px] mx-auto h-[420px] max-w-4xl opacity-[0.2] blur-[90px]" style={{ background: `linear-gradient(90deg, ${G.blue}, ${G.red}, ${G.yellow}, ${G.green})` }} />
        <div className="relative mx-auto max-w-3xl">
          <h2 className="masthead text-[clamp(34px,6vw,64px)] leading-[1.02]">
            {t("marketing.finalCta.title")}
            <br />
            <span className="text-muted-foreground">{t("marketing.finalCta.titleAccent")}</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[19px] leading-[1.5] text-muted-foreground">{t("marketing.finalCta.body")}</p>
          <div className="mt-10 flex justify-center">
            <Button size="lg" asChild>
              <Link href={signedIn ? "/overview" : "/signup"}>
                {signedIn ? t("marketing.hero.openApp") : t("marketing.finalCta.cta")} <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-[#F5F5F7] px-5 py-10 sm:px-8 dark:bg-card/40">
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
