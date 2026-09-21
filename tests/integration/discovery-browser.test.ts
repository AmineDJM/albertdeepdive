import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { launchBrowser } from "@/server/browser";
import { READ_PAGE_SCRIPT, type PageReading } from "@/server/tenancy/discovery-browser";
import { rankColours, rankLogos, factsFromJsonLd } from "@/lib/brand/organisation";

/**
 * The half of website discovery that only a browser can do.
 *
 * The fixtures are served to a real Chromium from a route handler, so the page has an origin,
 * loads its own images, applies its own stylesheet and resolves its own relative URLs — all of
 * which the extraction depends on and none of which `setContent` provides. What is being proved is
 * the thing the cheap fetch pass cannot do: find the mark in the rendered header, refuse the
 * partner logo sitting next to it, and report the colour the page actually painted.
 */

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="#1d4ed8"/></svg>`;
const PARTNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24"><rect width="80" height="24" fill="#888"/></svg>`;

const RENDERED_SITE = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Acme — On construit des choses</title>
  <meta name="description" content="Acme construit des outils pour les équipes éditoriales.">
  <meta name="theme-color" content="#1d4ed8">
  <link rel="apple-touch-icon" sizes="180x180" href="/touch-icon.png">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Organization","name":"Acme","legalName":"Acme SAS",
     "logo":"https://acme.test/logo.svg","foundingDate":"2016-03-01",
     "sameAs":["https://www.linkedin.com/company/acme","https://x.com/acme"]}
  </script>
  <style>
    body { margin: 0; font-family: "Newsreader", Georgia, serif; }
    header { display: flex; gap: 24px; align-items: center; padding: 16px; }
    h1 { font-family: "Inter", sans-serif; }
    .hero { background: #1d4ed8; height: 420px; }
  </style>
</head>
<body>
  <header>
    <a href="/"><img class="site-logo" src="/logo.svg" alt="Acme"></a>
    <img class="partner-logo" src="/partner.svg" alt="Our partner">
    <nav><a href="/about">À propos</a></nav>
  </header>
  <div class="hero"><h1>On construit des choses</h1></div>
  <footer>
    <a href="mailto:bonjour@acme.test">bonjour@acme.test</a>
    <a href="tel:+33123456789">01 23 45 67 89</a>
    <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
    <a href="https://www.instagram.com/acme">Instagram</a>
  </footer>
</body>
</html>`;

const INLINE_MARK_SITE = `<!doctype html>
<html lang="en"><head><title>Northgate</title></head>
<body>
  <header style="padding:12px">
    <a href="/" aria-label="Northgate home">
      <svg class="logo" width="120" height="32" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="32" fill="#0f766e"/></svg>
    </a>
  </header>
  <p>Northgate is a community of makers.</p>
</body></html>`;

async function read(browser: Browser, html: string): Promise<PageReading> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/logo.svg") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: LOGO_SVG });
      if (path === "/partner.svg") return route.fulfill({ status: 200, contentType: "image/svg+xml", body: PARTNER_SVG });
      if (path === "/" || path === "/index.html") return route.fulfill({ status: 200, contentType: "text/html", body: html });
      return route.fulfill({ status: 404, contentType: "text/plain", body: "" });
    });
    await page.goto("https://acme.test/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    return (await page.evaluate(READ_PAGE_SCRIPT, { maxText: 12_000 })) as PageReading;
  } finally {
    await context.close();
  }
}

describe("reading a website with a real browser", () => {
  let browser: Browser;
  let reading: PageReading;

  beforeAll(async () => {
    browser = await launchBrowser();
    reading = await read(browser, RENDERED_SITE);
  }, 180_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it("finds the mark in the header and refuses the partner's", () => {
    const ranked = rankLogos(reading.logos);
    expect(ranked[0]?.url).toBe("https://acme.test/logo.svg");
    expect(ranked.map((c) => c.url)).not.toContain("https://acme.test/partner.svg");
  });

  it("measures the mark rather than guessing at it", () => {
    const mark = reading.logos.find((candidate) => candidate.url.endsWith("/logo.svg"));
    expect(mark).toBeTruthy();
    expect(mark!.linksHome).toBe(true);
    expect(mark!.inHeader).toBe(true);
    expect(mark!.width).toBe(160);
    expect(mark!.height).toBe(40);
  });

  it("reports the colour the page actually painted", () => {
    expect(rankColours(reading.colours)).toContain("#1d4ed8");
  });

  it("reads the structured data the site publishes about itself", () => {
    const facts = factsFromJsonLd(reading.jsonLd);
    expect(facts.name).toBe("Acme");
    expect(facts.legalName).toBe("Acme SAS");
    expect(facts.foundedYear).toBe(2016);
    expect(facts.sameAs).toContain("https://x.com/acme");
  });

  it("takes the fonts the browser resolved, not the ones the CSS asked for first", () => {
    expect(reading.fonts).toContain("Inter");
    expect(reading.fonts).toContain("Newsreader");
  });

  it("picks up the contact details and the social profiles", () => {
    expect(reading.emails).toContain("bonjour@acme.test");
    expect(reading.phones).toContain("+33123456789");
    expect(reading.socials).toContain("https://www.instagram.com/acme");
  });

  it("keeps the language, the description and the words on the page", () => {
    expect(reading.lang).toBe("fr");
    expect(reading.description).toBe("Acme construit des outils pour les équipes éditoriales.");
    expect(reading.text).toContain("On construit des choses");
    expect(reading.markIsInline).toBe(false);
  });

  it("says when the header's mark is drawn into the page and has no address", async () => {
    const inline = await read(browser, INLINE_MARK_SITE);
    expect(inline.markIsInline).toBe(true);
    expect(rankLogos(inline.logos).map((c) => c.url)).not.toContain("");
  });
});
