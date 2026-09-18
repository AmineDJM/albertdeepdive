import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, Check } from "lucide-react";
import { completePaidCheckout } from "@/server/payments/readers";
import { publicationBySubscribeSlug } from "@/server/subscribers/service";
import { BRAND } from "@/lib/brand";
import { translator } from "@/lib/i18n";

export const metadata: Metadata = { title: "Welcome", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Back from Stripe.
 *
 * The session id in the URL is a pointer, not a proof: the page asks Stripe, with the publisher's
 * own key, whether that checkout completed, and only then records the reader as subscribed and
 * paying. Reloading the page records the same facts again and changes nothing.
 */
export default async function WelcomePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ session_id?: string }> }) {
  const [{ slug }, { session_id: sessionId }] = await Promise.all([params, searchParams]);
  const publication = await publicationBySubscribeSlug(slug);
  const t = translator(publication?.language ?? "en");
  let error: string | null = null;
  try {
    if (!sessionId) throw new Error("This link is missing its payment reference.");
    await completePaidCheckout(slug, sessionId);
  } catch (err) {
    error = err instanceof Error ? err.message : "This link is not valid.";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto size-8 text-muted-foreground" />
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{t("subscribe.paymentFailedTitle")}</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{error}</p>
            <Link href={`/s/${slug}`} className="mt-6 inline-block text-[13px] font-medium underline underline-offset-4">
              {t("subscribe.tryAgain")}
            </Link>
          </>
        ) : (
          <>
            <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-600/10">
              <Check className="size-5 text-emerald-600" />
            </span>
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{t("subscribe.paidTitle")}</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{t("subscribe.paidBody")}</p>
          </>
        )}
        <p className="mt-10 text-2xs text-muted-foreground">{t("subscribe.publishedWith", { brand: BRAND.name })}</p>
      </div>
    </main>
  );
}
