import { cache } from "react";
import { headers } from "next/headers";
import { getCurrentUser } from "@/server/auth/session";
import { getTenant } from "@/server/tenancy/context";
import { isLocale, localeFromHeader, translator, type Locale, type Translate } from "@/lib/i18n";
import { uiTranslator, type UiTranslate } from "@/lib/i18n/ui";

/**
 * Which language a screen is in.
 *
 * In order: what the person chose for themselves, then their workspace's language, then what their
 * browser asked for, then English. A reader-facing page does not use this at all — it takes the
 * language of the publication they subscribed to, which is passed in explicitly.
 */
export const currentLocale = cache(async (): Promise<Locale> => {
  try {
    const user = await getCurrentUser();
    const preferred = (user?.preferences as { locale?: string } | undefined)?.locale;
    if (isLocale(preferred)) return preferred;

    const tenant = await getTenant();
    if (isLocale(tenant?.locale)) return tenant.locale;

    const h = await headers();
    return localeFromHeader(h.get("accept-language"));
  } catch {
    return "en";
  }
});

/** A translator for the current screen. */
export async function getTranslations(): Promise<Translate> {
  return translator(await currentLocale());
}

/**
 * The interface translator for the current request.
 *
 * Async, because the first thing it needs — who is signed in and what they chose — is. The locale
 * it resolves is kept for the request in a React cache box, which is what lets the sync `ui()`
 * below serve everything rendered afterwards: a page awaits `getUi()` once, and the components
 * beneath it read the answer without asking again.
 */
const requestLocale = cache(() => ({ value: null as Locale | null }));

export async function getUi(): Promise<UiTranslate> {
  const locale = await currentLocale();
  requestLocale().value = locale;
  return uiTranslator(locale);
}

/** The sync form, for components rendered after a page has awaited `getUi()`. English until then. */
export function ui(): UiTranslate {
  return uiTranslator(requestLocale().value ?? "en");
}
