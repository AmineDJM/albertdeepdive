import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicJoinShelf } from "@/server/contributors/join";
import { showsBrieflyBranding } from "@/server/billing/entitlements";
import { BRAND } from "@/lib/brand";
import { translator } from "@/lib/i18n";
import { JoinForm } from "../../join-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  const shelf = await publicJoinShelf(orgSlug);
  if (!shelf) return { title: "Not found" };
  return { title: { absolute: shelf.organization.name }, robots: { index: true, follow: true } };
}

/** Write for any of them: one form, tick the newsletters. */
export default async function JoinShelfPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const shelf = await publicJoinShelf(orgSlug);
  if (!shelf) notFound();
  const showBriefly = await showsBrieflyBranding(shelf.organization.id);
  const locale = shelf.publications[0].language === "fr" ? "fr" : "en";
  const t = translator(locale);
  const colours = (shelf.organization.brandColours ?? {}) as { primary?: string; accent?: string };
  const accent = colours.primary ?? colours.accent ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="masthead text-[26px] leading-tight font-semibold tracking-tight">{t("join.shelfTitle", { name: shelf.organization.name })}</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">{t("join.shelfIntro")}</p>
        </div>
        <JoinForm
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
