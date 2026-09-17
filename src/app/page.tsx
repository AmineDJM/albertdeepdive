import type { Metadata } from "next";
import { getCurrentUser } from "@/server/auth/session";
import { listPlans } from "@/server/billing/plans";
import { currentLocale, getTranslations } from "@/server/i18n/locale";
import { env } from "@/server/env";
import { BRAND } from "@/lib/brand";
import { Landing } from "./(marketing)/landing";
import type { MarketingPlan } from "@/components/marketing/pricing-table";

export const dynamic = "force-dynamic";

const OG_IMAGE = "/opengraph-image";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale();
  const title = `${BRAND.name} — ${BRAND.tagline}`;
  const url = env.NEXT_PUBLIC_APP_URL;

  return {
    // `absolute` because the app-wide template appends "· Briefly", which would read twice here.
    title: { absolute: title },
    description: BRAND.description,
    metadataBase: new URL(url),
    alternates: { canonical: "/", languages: { en: "/", fr: "/" } },
    keywords: [
      "internal newsletter",
      "company newsletter software",
      "employee communication",
      "digital magazine software",
      "publishing platform",
      "newsletter for schools",
      "alumni newsletter",
      "campus newspaper software",
      "portfolio update newsletter",
      "print and digital publishing",
    ],
    openGraph: {
      type: "website",
      url,
      siteName: BRAND.name,
      title,
      description: BRAND.description,
      locale: locale === "fr" ? "fr_FR" : "en_GB",
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: `${BRAND.name} — ${BRAND.tagline}` }],
    },
    twitter: { card: "summary_large_image", title, description: BRAND.description, images: [OG_IMAGE] },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  };
}

/**
 * The public front door.
 *
 * Plans come from the database, so the prices a visitor reads are the prices the product enforces —
 * there is no second copy of the pricing to drift. Structured data describes the software and its
 * offers, and the FAQ, so a search engine can render both without guessing.
 */
export default async function HomePage() {
  const [user, t, plans, locale] = await Promise.all([getCurrentUser(), getTranslations(), listPlans(), currentLocale()]);

  const marketingPlans: MarketingPlan[] = plans.map((plan) => ({
    key: plan.key,
    name: plan.name,
    tagline: plan.tagline,
    priceMonthlyCents: plan.priceMonthlyCents,
    priceYearlyCents: plan.priceYearlyCents,
    currency: plan.currency,
    highlights: plan.highlights,
    isFeatured: plan.isFeatured,
    isCustomPriced: plan.isCustomPriced,
    isFree: plan.priceMonthlyCents === 0 && !plan.isCustomPriced,
  }));

  const url = env.NEXT_PUBLIC_APP_URL;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: BRAND.name,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url,
        description: BRAND.description,
        inLanguage: locale === "fr" ? "fr" : "en",
        offers: marketingPlans
          .filter((plan) => !plan.isCustomPriced)
          .map((plan) => ({
            "@type": "Offer",
            name: plan.name,
            price: (plan.priceMonthlyCents / 100).toFixed(2),
            priceCurrency: plan.currency,
            url: `${url}#pricing`,
            availability: "https://schema.org/InStock",
          })),
      },
      {
        "@type": "FAQPage",
        mainEntity: Array.from({ length: 10 }, (_, i) => ({
          "@type": "Question",
          name: t(`marketing.faq.q${i + 1}` as "marketing.faq.q1"),
          acceptedAnswer: { "@type": "Answer", text: t(`marketing.faq.a${i + 1}` as "marketing.faq.a1") },
        })),
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <Landing plans={marketingPlans} signedIn={!!user} t={t} />
    </>
  );
}
