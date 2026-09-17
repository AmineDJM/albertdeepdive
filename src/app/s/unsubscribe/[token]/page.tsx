import type { Metadata } from "next";
import { AlertCircle, Check } from "lucide-react";
import { unsubscribe } from "@/server/subscribers/service";
import { BRAND } from "@/lib/brand";
import { translator } from "@/lib/i18n";

export const metadata: Metadata = { title: "Unsubscribed", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Unsubscribing is a GET, on purpose.
 *
 * Mail clients and the one-click List-Unsubscribe header both follow the link without asking, and a
 * reader who wants out should get out — not land on a page with one more button to press. There is
 * nothing destructive behind it beyond stopping the mail, and the token is unguessable.
 */
export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ p?: string }> }) {
  const [{ token }, { p }] = await Promise.all([params, searchParams]);
  let error: string | null = null;
  let remaining = 0;
  let locale = "en";
  try {
    const result = await unsubscribe(token, p);
    remaining = result.remaining;
    locale = result.subscriber.locale;
  } catch (err) {
    error = err instanceof Error ? err.message : "This link is not valid.";
  }
  const t = translator(locale);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto size-8 text-muted-foreground" />
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{t("subscribe.unsubscribeFailedTitle")}</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
              <Check className="size-5 text-muted-foreground" />
            </span>
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">{t("subscribe.unsubscribedTitle")}</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
              {remaining > 0 ? t("subscribe.unsubscribedSome", { count: remaining }) : t("subscribe.unsubscribedAll")}
            </p>
          </>
        )}
        <p className="mt-10 text-2xs text-muted-foreground">{t("subscribe.publishedWith", { brand: BRAND.name })}</p>
      </div>
    </main>
  );
}
