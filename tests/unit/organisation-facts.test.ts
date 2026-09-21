import { describe, expect, it } from "vitest";
import {
  EMPTY_FACTS,
  factsFromJsonLd,
  mergeFacts,
  profileFromFacts,
  profileFromSettings,
  rankColours,
  rankLogos,
  scoreLogo,
  whatIsMissing,
  type LogoCandidate,
} from "@/lib/brand/organisation";

const block = (value: unknown) => JSON.stringify(value);

describe("factsFromJsonLd", () => {
  it("reads a plain Organization node", () => {
    const facts = factsFromJsonLd([
      block({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Acme",
        legalName: "Acme SAS",
        description: "  We build things.  ",
        logo: "https://acme.com/logo.svg",
        email: "mailto:hello@acme.com",
        telephone: "+33 1 23 45 67 89",
        foundingDate: "1998-04-02",
        sameAs: ["https://www.linkedin.com/company/acme", "https://x.com/acme"],
      }),
    ]);
    expect(facts.name).toBe("Acme");
    expect(facts.legalName).toBe("Acme SAS");
    expect(facts.description).toBe("We build things.");
    expect(facts.logoUrl).toBe("https://acme.com/logo.svg");
    expect(facts.email).toBe("hello@acme.com");
    expect(facts.telephone).toBe("+33 1 23 45 67 89");
    expect(facts.foundedYear).toBe(1998);
    expect(facts.sameAs).toEqual(["https://www.linkedin.com/company/acme", "https://x.com/acme"]);
  });

  it("finds the organisation inside an @graph", () => {
    const facts = factsFromJsonLd([
      block({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "acme.com" },
          { "@type": "EducationalOrganization", name: "Albert School", logo: { "@type": "ImageObject", url: "https://albert.school/logo.png" } },
        ],
      }),
    ]);
    expect(facts.name).toBe("Albert School");
    expect(facts.logoUrl).toBe("https://albert.school/logo.png");
  });

  it("follows publisher on an article page, which is where most sites put the organisation", () => {
    const facts = factsFromJsonLd([
      block({
        "@type": "NewsArticle",
        headline: "Something happened",
        publisher: { "@type": "NewsMediaOrganization", name: "The Paper", logo: { url: "https://paper.example/logo.svg" } },
      }),
    ]);
    expect(facts.name).toBe("The Paper");
    expect(facts.logoUrl).toBe("https://paper.example/logo.svg");
  });

  it("keeps reading after a malformed block", () => {
    const facts = factsFromJsonLd(["{ not json at all", block({ "@type": "Corporation", name: "Still Found" })]);
    expect(facts.name).toBe("Still Found");
  });

  it("takes the first of an array-valued field, as schema.org allows", () => {
    const facts = factsFromJsonLd([
      block([{ "@type": ["Thing", "Organization"], name: ["Acme", "Acme Inc"], image: ["https://acme.com/a.png"] }]),
    ]);
    expect(facts.name).toBe("Acme");
    expect(facts.logoUrl).toBe("https://acme.com/a.png");
  });

  it("assembles a postal address out of its parts", () => {
    const facts = factsFromJsonLd([
      block({
        "@type": "Organization",
        name: "Acme",
        address: { "@type": "PostalAddress", streetAddress: "5 rue de la Paix", postalCode: "75002", addressLocality: "Paris", addressCountry: "FR" },
      }),
    ]);
    expect(facts.address).toBe("5 rue de la Paix, 75002, Paris, FR");
  });

  it("refuses a founding year that cannot be one", () => {
    expect(factsFromJsonLd([block({ "@type": "Organization", name: "A", foundingDate: "soon" })]).foundedYear).toBeNull();
    expect(factsFromJsonLd([block({ "@type": "Organization", name: "A", foundingDate: "3021-01-01" })]).foundedYear).toBeNull();
  });

  it("returns nothing when no node is an organisation", () => {
    expect(factsFromJsonLd([block({ "@type": "BreadcrumbList", itemListElement: [] })])).toEqual(EMPTY_FACTS);
    expect(factsFromJsonLd([])).toEqual(EMPTY_FACTS);
  });
});

describe("mergeFacts", () => {
  it("prefers the browser when it answered", () => {
    const merged = mergeFacts({ name: "acme.com", logoUrl: "https://acme.com/og.png" }, { name: "Acme", logoUrl: "https://acme.com/logo.svg" });
    expect(merged.name).toBe("Acme");
    expect(merged.logoUrl).toBe("https://acme.com/logo.svg");
  });

  it("keeps the cheap reading where the browser found nothing", () => {
    const merged = mergeFacts({ name: "Acme", description: "We build things." }, { name: null, description: "" });
    expect(merged.name).toBe("Acme");
    expect(merged.description).toBe("We build things.");
  });

  it("unions the profiles rather than choosing a side", () => {
    const merged = mergeFacts({ sameAs: ["https://x.com/acme"] }, { sameAs: ["https://www.linkedin.com/company/acme", "https://x.com/acme"] });
    expect(merged.sameAs).toEqual(["https://www.linkedin.com/company/acme", "https://x.com/acme"]);
  });

  it("is EMPTY_FACTS when neither reading found anything", () => {
    expect(mergeFacts({}, {})).toEqual(EMPTY_FACTS);
  });
});

describe("whatIsMissing", () => {
  it("names the fields nobody answered", () => {
    expect(whatIsMissing(EMPTY_FACTS)).toEqual(["name", "description", "logo"]);
    expect(whatIsMissing({ ...EMPTY_FACTS, name: "Acme", description: "d", logoUrl: "u" })).toEqual([]);
  });
});

const candidate = (over: Partial<LogoCandidate>): LogoCandidate => ({
  url: "https://acme.com/x.png",
  kind: "img",
  alt: "",
  hint: "",
  inHeader: false,
  linksHome: false,
  width: 160,
  height: 40,
  top: 20,
  ...over,
});

describe("choosing between the pictures in a header", () => {
  it("prefers the mark in the link home over a picture further down the page", () => {
    const ranked = rankLogos([
      candidate({ url: "https://acme.com/hero.jpg", top: 700, width: 1200, height: 600 }),
      candidate({ url: "https://acme.com/logo.svg", inHeader: true, linksHome: true, hint: "site-logo" }),
    ]);
    expect(ranked[0].url).toBe("https://acme.com/logo.svg");
  });

  it("refuses what a header holds that is not the organisation's mark", () => {
    for (const hint of ["partner-logo", "social-icon", "app-store-badge", "payment visa", "language-flag"]) {
      expect(scoreLogo(candidate({ hint, inHeader: true, linksHome: true }))).toBeLessThan(0);
    }
  });

  it("trusts what the site declared about itself above what it happens to display", () => {
    const ranked = rankLogos([candidate({ url: "https://acme.com/header.png", inHeader: true }), candidate({ url: "https://acme.com/declared.svg", kind: "structured" })]);
    expect(ranked[0].url).toBe("https://acme.com/declared.svg");
  });

  it("marks down a shape no mark ever has", () => {
    const mark = candidate({ hint: "logo" });
    expect(scoreLogo(candidate({ hint: "logo", width: 8, height: 8 }))).toBeLessThan(scoreLogo(mark));
    expect(scoreLogo(candidate({ hint: "logo", width: 1600, height: 900 }))).toBeLessThan(scoreLogo(mark));
    expect(scoreLogo(candidate({ hint: "logo", width: 1200, height: 4 }))).toBeLessThan(scoreLogo(mark));
  });

  it("shows each address once, and no more than a shortlist", () => {
    const same = Array.from({ length: 12 }, (_, i) => candidate({ url: `https://acme.com/${i % 3}.png`, hint: "logo" }));
    const ranked = rankLogos(same);
    expect(ranked).toHaveLength(3);
    expect(new Set(ranked.map((c) => c.url)).size).toBe(3);
  });

  it("returns nothing rather than a bad guess when everything is disqualified", () => {
    expect(rankLogos([candidate({ hint: "partner" }), candidate({ hint: "sponsor" })])).toEqual([]);
  });
});

describe("the colours a page actually painted", () => {
  it("drops paper, ink and grey however much of the page they cover", () => {
    expect(
      rankColours([
        { hex: "#ffffff", area: 900_000 },
        { hex: "#000000", area: 400_000 },
        { hex: "#767676", area: 300_000 },
        { hex: "#1d4ed8", area: 20_000 },
      ]),
    ).toEqual(["#1d4ed8"]);
  });

  it("prefers a saturated colour used a lot to a vivid speck", () => {
    const ranked = rankColours([
      { hex: "#1d4ed8", area: 500_000 },
      { hex: "#ff0000", area: 40 },
    ]);
    expect(ranked[0]).toBe("#1d4ed8");
  });

  it("does not report one brand colour four times", () => {
    const ranked = rankColours([
      { hex: "#1d4ed8", area: 500_000 },
      { hex: "#1e4fd9", area: 400_000 },
      { hex: "#2050da", area: 300_000 },
      { hex: "#d81d4e", area: 200_000 },
    ]);
    expect(ranked).toEqual(["#1d4ed8", "#d81d4e"]);
  });

  it("ignores anything that is not a colour", () => {
    expect(rankColours([{ hex: "transparent", area: 900 }, { hex: "", area: 900 }])).toEqual([]);
  });
});

describe("the organisation profile", () => {
  it("keeps only the facts a workspace stores", () => {
    const facts = { ...EMPTY_FACTS, legalName: "Acme SAS", email: "hello@acme.com", foundedYear: 2016, description: "ignored here" };
    expect(profileFromFacts(facts)).toEqual({ legalName: "Acme SAS", email: "hello@acme.com", foundedYear: 2016 });
  });

  it("reads a saved profile back out of the settings blob", () => {
    expect(profileFromSettings({ profile: { legalName: "Acme SAS", foundedYear: 2016 }, other: true })).toEqual({ legalName: "Acme SAS", foundedYear: 2016 });
  });

  it("is empty rather than wrong when the settings hold something else", () => {
    expect(profileFromSettings(null)).toEqual({});
    expect(profileFromSettings({ profile: "nonsense" })).toEqual({});
    expect(profileFromSettings({ profile: { foundedYear: "2016" } })).toEqual({});
  });
});
