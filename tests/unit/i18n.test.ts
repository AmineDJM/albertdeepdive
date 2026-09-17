import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { fr } from "@/lib/i18n/fr";
import { dictionaryFor, isLocale, LOCALES, localeFromHeader, plural, translator } from "@/lib/i18n";
import { AUDIENCE_TABS, EDITION_TABS, INSIGHTS_TABS, NAV_ITEMS, PLATFORM_TABS, WORKBENCH_TABS } from "@/components/newsroom/nav";

function flatten(object: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null ? flatten(value as Record<string, unknown>, path) : [path];
  });
}

describe("dictionaries", () => {
  const enKeys = flatten(en as unknown as Record<string, unknown>).sort();
  const frKeys = flatten(fr as unknown as Record<string, unknown>).sort();

  it("say the same things in both languages", () => {
    expect(frKeys).toEqual(enKeys);
  });

  it("has no untranslated strings left in French", () => {
    // Not a spellcheck — a guard against a key being copied across and never translated.
    const identical = enKeys.filter((key) => {
      const a = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], en);
      const b = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], fr);
      return typeof a === "string" && a === b;
    });
    // Words that are the same in both are fine: "Publications", "Type", "Media", "Exports"…
    expect(identical.length).toBeLessThan(enKeys.length * 0.15);
  });

  it("keeps the same placeholders on both sides", () => {
    // A dropped {date} leaves a sentence with a hole in it, in production, in one language only.
    for (const key of enKeys) {
      const a = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], en) as string;
      const b = key.split(".").reduce<unknown>((n, p) => (n as Record<string, unknown>)?.[p], fr) as string;
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(b), `placeholders differ for ${key}`).toEqual(placeholders(a));
    }
  });
});

describe("translator", () => {
  it("returns the string for the locale", () => {
    expect(translator("en")("common.save")).toBe("Save");
    expect(translator("fr")("common.save")).toBe("Enregistrer");
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    expect(translator("en")("billing.onPlan", { workspace: "Acme", plan: "Pro" })).toBe("Acme is on the Pro plan.");
    expect(translator("en")("billing.renews", {})).toBe("Renews {date}");
  });

  it("falls back to English, then to the key, rather than showing nothing", () => {
    // A half-translated build should show English words to somebody trying to use the product.
    expect(translator("de")("common.save")).toBe("Save");
    expect(translator("fr")("nope.missing" as "common.save")).toBe("nope.missing");
  });

  it("recognises its locales", () => {
    expect(LOCALES).toEqual(["en", "fr"]);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(dictionaryFor("de")).toBe(en);
  });
});

describe("localeFromHeader", () => {
  it("picks the best supported language a browser asks for", () => {
    expect(localeFromHeader("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(localeFromHeader("en-GB,en;q=0.9")).toBe("en");
    expect(localeFromHeader("de-DE,de;q=0.9,fr;q=0.5")).toBe("fr");
    expect(localeFromHeader("de-DE")).toBe("en");
    expect(localeFromHeader(null)).toBe("en");
    expect(localeFromHeader("")).toBe("en");
  });
});

describe("plural", () => {
  it("chooses a form and substitutes the count", () => {
    expect(plural(1, { one: "{count} title", other: "{count} titles" })).toBe("1 title");
    expect(plural(3, { one: "{count} title", other: "{count} titles" })).toBe("3 titles");
    expect(plural(0, { one: "{count} title", other: "{count} titles" })).toBe("0 titles");
  });
});

describe("navigation labels", () => {
  it("are keys that both dictionaries answer", () => {
    const t = translator("fr");
    const en_ = translator("en");
    const labels = [
      ...NAV_ITEMS.map((item) => item.label),
      ...[WORKBENCH_TABS, AUDIENCE_TABS, INSIGHTS_TABS, PLATFORM_TABS].flat().map((tab) => tab.label),
      ...EDITION_TABS.map((tab) => tab.label),
    ];
    expect(labels.length).toBeGreaterThan(10);
    for (const key of labels) {
      // A key that resolves to itself is a key with no string behind it.
      expect(en_(key), key).not.toBe(key);
      expect(t(key), key).not.toBe(key);
    }
  });
});
