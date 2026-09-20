import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicShelf } from "@/server/subscribers/service";
import { showsBrieflyBranding } from "@/server/billing/entitlements";
import { BRAND } from "@/lib/brand";
import { translator } from "@/lib/i18n";
import { ShelfForm } from "./shelf-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  const shelf = await publicShelf(orgSlug);
  if (!shelf) return { title: "Not found" };
  const title = `${shelf.organization.name}`;
  return { title: { absolute: title }, robots: { index: true, follow: true } };
}

/**
 * One link for everything a workspace publishes.
 *
 * The per-newsletter link is the one that gets shared at the bottom of an issue. This is the one
 * that goes on a website's footer, where a visitor has not yet decided which of three titles they
 * want — so they tick, and one address takes them all.
 */
export default async function ShelfPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shelf = await publicShelf(orgSlug);
  if (!shelf) notFound();
  const showBriefly = await showsBrieflyBranding(shelf.organization.id);

  const locale = shelf.publications[0].language === "fr" ? "fr" : "en";
  const t = translator(locale);
  const colours = (shelf.organization.brandColours ?? {}) as { primary?: string; accent?: string };
  const accent = colours.primary ?? colours.accent ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="masthead text-[26px] leading-tight font-semibold tracking-tight">{t("subscribe.everythingFrom", { name: shelf.organization.name })}</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">{t("subscribe.shelfIntro")}</p>
        </div>
        <ShelfForm
          orgSlug={orgSlug}
          accent={accent}
          locale={locale}
          titles={shelf.publications.map((publication) => ({ id: publication.id, name: publication.name, description: publication.description }))}
        />
        {showBriefly ? <p className="mt-8 text-center text-2xs text-muted-foreground">{t("subscribe.publishedWith", { brand: BRAND.name })}</p> : null}
      </div>
    </main>
  );
}
