import type { Metadata } from "next";
import { AlertCircle, Check } from "lucide-react";
import { confirmSubscription } from "@/server/subscribers/service";
import { BRAND } from "@/lib/brand";
import { translator } from "@/lib/i18n";

export const metadata: Metadata = { title: "Confirm your subscription", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The reader told us their language when they subscribed; the error path has nothing to go on,
  // so it falls back to English.
  let locale = "en";
  let error: string | null = null;
  try {
    const subscriber = await confirmSubscription(token);
    locale = subscriber.locale;
  } catch (err) {
    error = err instanceof Error ? err.message : "This confirmation link is not valid.";
  }
  const t = translator(locale);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto size-8 text-muted-foreground" />
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{t("subscribe.confirmFailedTitle")}</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-emerald-600/10">
              <Check className="size-5 text-emerald-600" />
            </span>
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{t("subscribe.confirmTitle")}</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{t("subscribe.confirmBody")}</p>
          </>
        )}
        <p className="mt-10 text-2xs text-muted-foreground">{t("subscribe.publishedWith", { brand: BRAND.name })}</p>
      </div>
    </main>
  );
}
