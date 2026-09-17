"use client";

import { createContext, useContext, useMemo } from "react";
import { translator, type Locale, type Translate } from "@/lib/i18n";

/**
 * The locale for client components.
 *
 * The dictionaries are small and static, so both ship in the client bundle and the translator is
 * built in the browser. That avoids a round trip for a string and keeps `t()` synchronous, which is
 * what makes it usable inside a render.
 */
const LocaleContext = createContext<{ locale: Locale; t: Translate }>({ locale: "en", t: translator("en") });

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: translator(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useTranslations(): Translate {
  return useContext(LocaleContext).t;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}
