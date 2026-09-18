import type { UiTranslate } from "@/lib/i18n/ui";

/**
 * The words the gallery puts on its filters.
 *
 * In one place and written as literals, so the dictionary test sees every one of them and a new
 * organisation type cannot reach a visitor in English on a French page.
 */
export function categoryLabels(tr: UiTranslate): Record<string, string> {
  return {
    COMPANY: tr("Companies"),
    SCHOOL: tr("Schools"),
    UNIVERSITY: tr("Universities"),
    ASSOCIATION: tr("Associations"),
    COMMUNITY: tr("Communities"),
    INVESTOR: tr("Investors"),
    MEDIA: tr("Media"),
    INSTITUTION: tr("Institutions"),
    OTHER: tr("Other"),
  };
}

export function languageLabels(tr: UiTranslate): Record<string, string> {
  return { en: tr("English"), fr: tr("French") };
}
