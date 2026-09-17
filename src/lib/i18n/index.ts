import { en } from "./en";
import { fr } from "./fr";

/**
 * Translation.
 *
 * A dictionary of nested objects keyed by a dotted path, with no dependency. The alternative was a
 * routing library that puts the locale in the URL, which Briefly does not want: a workspace has one
 * interface language, a publication has its own, and a reader gets the language of the publication
 * they subscribed to — none of which are properties of the path.
 *
 * `en` is the source of truth. Every other dictionary is typed against it, so adding an English
 * string and forgetting the French one is a type error rather than a blank space in production.
 */

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = { en: "English", fr: "Français" };

/** The shape of a dictionary: English's keys, with values widened from literals to plain strings. */
export type Dictionary = { readonly [K in keyof typeof en]: { readonly [P in keyof (typeof en)[K]]: string } };

const DICTIONARIES: Record<Locale, Dictionary> = { en, fr };

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** Falls back to English for an unknown locale rather than showing keys. */
export function dictionaryFor(locale: string | null | undefined): Dictionary {
  return isLocale(locale) ? DICTIONARIES[locale] : en;
}

/** Best match from an Accept-Language header, for readers who have never told us anything. */
export function localeFromHeader(header: string | null | undefined): Locale {
  if (!header) return "en";
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    const base = tag?.split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}

type Path<T> = T extends object ? { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Path<T[K]>}` }[keyof T & string] : never;
export type TranslationKey = Path<Dictionary>;

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

/**
 * A translator for one locale.
 *
 * A missing key falls through to English and then to the key itself: a half-translated build should
 * show English words, never `settings.billing.title`, to somebody trying to use the product.
 * Placeholders are `{name}` — deliberately not a template engine.
 */
export function translator(locale: string | null | undefined): Translate {
  const dictionary = dictionaryFor(locale);
  return (key, values) => {
    const template = lookup(dictionary, key) ?? lookup(en, key) ?? key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
  };
}

/** Plural choice for the two languages Briefly ships in; both have the same one/other split. */
export function plural(count: number, forms: { one: string; other: string }) {
  return (count === 1 ? forms.one : forms.other).replace("{count}", String(count));
}
