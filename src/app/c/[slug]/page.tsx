import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicationByJoinSlug } from "@/server/contributors/join";
import { showsBrieflyBranding } from "@/server/billing/entitlements";
import { BRAND } from "@/lib/brand";
import { translator } from "@/lib/i18n";
import { JoinForm } from "../join-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const publication = await publicationByJoinSlug(slug);
  if (!publication) return { title: "Not found" };
  const t = translator(publication.language);
  const title = t("join.title", { name: publication.name });
  return { title: { absolute: title }, description: publication.description ?? undefined, robots: { index: true, follow: true } };
}

/**
 * Write for this newsletter.
 *
 * The mirror of the subscribe page, and the one that was missing: a title could collect readers
 * from a link and could only collect writers from somebody's address book.
 */
export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publication = await publicationByJoinSlug(slug);
  if (!publication) notFound();
  const showBriefly = await showsBrieflyBranding(publication.organizationId);
  const locale = publication.language === "fr" ? "fr" : "en";
  const t = translator(locale);
  const colours = (publication.organization?.brandColours ?? {}) as { primary?: string; accent?: string };
  const accent = colours.primary ?? colours.accent ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="masthead text-[26px] leading-tight font-semibold tracking-tight">{t("join.title", { name: publication.name })}</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">{t("join.intro")}</p>
        </div>
        <JoinForm slug={slug} accent={accent} locale={locale} titles={[{ id: publication.id, name: publication.name, description: publication.description }]} />
        {showBriefly ? <p className="mt-8 text-center text-2xs text-muted-foreground">{t("subscribe.publishedWith", { brand: BRAND.name })}</p> : null}
      </div>
    </main>
  );
}
