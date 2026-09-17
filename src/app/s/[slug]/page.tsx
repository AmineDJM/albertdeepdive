import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicationBySubscribeSlug } from "@/server/subscribers/service";
import { showsBrieflyBranding } from "@/server/billing/entitlements";
import { SubscribeForm } from "./subscribe-form";
import { BRAND } from "@/lib/brand";
import { translator } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const publication = await publicationBySubscribeSlug(slug);
  if (!publication) return { title: "Not found" };
  const title = `Subscribe to ${publication.name}`;
  return {
    title: { absolute: title },
    description: publication.description ?? `Get ${publication.name} from ${publication.organization?.name ?? ""}.`.trim(),
    openGraph: { title, description: publication.description ?? undefined, siteName: publication.organization?.name, type: "website" },
    robots: { index: true, follow: true },
  };
}

/**
 * The public subscribe page.
 *
 * It belongs to the customer, not to Briefly: their name, their colours, their words. Briefly's own
 * mark appears once, small, at the bottom — and on the plans that pay for it, not at all.
 */
export default async function SubscribePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publication = await publicationBySubscribeSlug(slug);
  if (!publication) notFound();
  // Paid plans take Briefly's mark off the pages their readers see.
  const showBriefly = await showsBrieflyBranding(publication.organizationId);

  // A reader gets the language of the title they are subscribing to, never the publisher's
  // interface language and never their own workspace's.
  const t = translator(publication.language);
  const org = publication.organization;
  const colours = (org?.brandColours ?? {}) as { primary?: string; accent?: string };
  const accent = colours.primary ?? colours.accent ?? "";
  const cadenceLabel: Record<string, { en: string; fr: string }> = {
    weekly: { en: "every week", fr: "chaque semaine" },
    fortnightly: { en: "every fortnight", fr: "toutes les deux semaines" },
    monthly: { en: "every month", fr: "chaque mois" },
    quarterly: { en: "every quarter", fr: "chaque trimestre" },
    irregular: { en: "when there is something worth sending", fr: "quand il y a quelque chose à dire" },
  };
  const cadence = (cadenceLabel[publication.cadence] ?? cadenceLabel.monthly)[publication.language === "fr" ? "fr" : "en"];

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt="" className="mx-auto mb-4 h-10 object-contain" />
          ) : null}
          <p className="label-caps">{org?.name}</p>
          <h1 className="masthead mt-1 text-[30px] leading-tight font-semibold tracking-[-0.02em]">{publication.name}</h1>
          {publication.description ? <p className="mt-3 text-[14px] leading-6 text-muted-foreground">{publication.description}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">{t("subscribe.publishedEvery", { cadence })}</p>
        </div>
        <SubscribeForm slug={slug} accent={accent} locale={publication.language === "fr" ? "fr" : "en"} />
        {showBriefly ? <p className="mt-10 text-center text-2xs text-muted-foreground">{t("subscribe.publishedWith", { brand: BRAND.name })}</p> : null}
      </div>
    </main>
  );
}
