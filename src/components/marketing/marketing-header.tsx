"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { BrieflyMark } from "@/components/brand/briefly-mark";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/components/i18n/provider";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * A header that gets out of the way.
 *
 * It sits on the page rather than over it until the visitor scrolls, at which point it settles into
 * a thin translucent bar. On a phone it collapses to a single sheet rather than a shrunken copy of
 * the desktop row — the CTA stays reachable either way.
 */
export function MarketingHeader({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const links = [
    { href: "#product", label: t("marketing.nav.product") },
    { href: "#examples", label: t("marketing.nav.examples") },
    { href: "#pricing", label: t("marketing.nav.pricing") },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300",
        scrolled ? "border-b border-border/70 bg-background/80 backdrop-blur-md" : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none" aria-label={BRAND.name}>
          <BrieflyMark className="size-[26px]" />
          <span className="text-[17px] font-semibold tracking-[-0.03em]">{BRAND.name}</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label={BRAND.name}>
          {links.map((link) => (
            <a key={link.href} href={link.href} className="text-[14px] text-muted-foreground transition-colors hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Button size="sm" asChild>
              <Link href="/overview">{t("nav.overview")}</Link>
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" asChild>
                <Link href="/login">{t("marketing.nav.logIn")}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/login?next=%2Fonboarding">{t("marketing.nav.startFree")}</Link>
              </Button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("marketing.nav.menu")}
          className="-mr-2 flex size-9 items-center justify-center rounded-md text-foreground md:hidden"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-border bg-background px-5 pt-3 pb-6 md:hidden">
          <nav className="flex flex-col" aria-label={BRAND.name}>
            {links.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="border-b border-border py-3 text-[15px] text-foreground">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-5 flex flex-col gap-2">
            {signedIn ? (
              <Button size="lg" asChild>
                <Link href="/overview">{t("nav.overview")}</Link>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild>
                  <Link href="/login?next=%2Fonboarding">{t("marketing.nav.startFree")}</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">{t("marketing.nav.logIn")}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
