"use client";

import { createContext, useContext, useMemo } from "react";
import { translator, type Locale, type Translate } from "@/lib/i18n";
import { uiTranslator, type UiTranslate } from "@/lib/i18n/ui";

/**
 * The locale for client components.
 *
 * The dictionaries are small and static, so both ship in the client bundle and the translator is
 * built in the browser. That avoids a round trip for a string and keeps `t()` synchronous, which is
 * what makes it usable inside a render.
 */
const LocaleContext = createContext<{ locale: Locale; t: Translate; tr: UiTranslate }>({ locale: "en", t: translator("en"), tr: uiTranslator("en") });

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: translator(locale), tr: uiTranslator(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useTranslations(): Translate {
  return useContext(LocaleContext).t;
}

/** The interface's own words, looked up by their English. See `@/lib/i18n/ui`. */
export function useUi(): UiTranslate {
  return useContext(LocaleContext).tr;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}
