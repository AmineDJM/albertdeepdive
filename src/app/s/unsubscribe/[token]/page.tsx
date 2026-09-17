import type { Metadata } from "next";
import { AlertCircle, Check } from "lucide-react";
import { unsubscribe } from "@/server/subscribers/service";
import { BRAND } from "@/lib/brand";

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
  try {
    const result = await unsubscribe(token, p);
    remaining = result.remaining;
  } catch (err) {
    error = err instanceof Error ? err.message : "This link is not valid.";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <AlertCircle className="mx-auto size-8 text-muted-foreground" />
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">We couldn&rsquo;t find that</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
              <Check className="size-5 text-muted-foreground" />
            </span>
            <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]">You&rsquo;re unsubscribed</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
              {remaining > 0
                ? `You won't get this one any more. You're still subscribed to ${remaining} other ${remaining === 1 ? "title" : "titles"}.`
                : "You won't receive anything else. Sorry to see you go."}
            </p>
          </>
        )}
        <p className="mt-10 text-2xs text-muted-foreground">Published with {BRAND.name}</p>
      </div>
    </main>
  );
}
