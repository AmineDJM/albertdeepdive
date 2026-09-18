import { UI_FR } from "./ui-fr";

/**
 * The interface's own words.
 *
 * The product's strings are written in English, in the code, where a developer can read a button
 * and know what it says. Translation looks the English up: the string is the key, the way gettext
 * has worked for thirty years. A string with no translation shows in English rather than as a key,
 * and a test lists every string the code uses against every dictionary, so a half-translated
 * build is a failing test rather than a surprise on somebody's screen.
 *
 * Separate from the structured dictionary in `index.ts`, which holds copy that never appears as a
 * literal in a component — marketing pages, reader-facing emails, the public subscribe pages —
 * and is addressed by key.
 */
export type UiTranslate = (text: string, values?: Record<string, string | number>) => string;

export const UI_DICTIONARIES: Record<string, Record<string, string>> = { fr: UI_FR };

export function uiTranslator(locale: string | null | undefined): UiTranslate {
  const dictionary = locale ? UI_DICTIONARIES[locale] : undefined;
  return (text, values) => {
    const template = dictionary?.[text] ?? text;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
  };
}
