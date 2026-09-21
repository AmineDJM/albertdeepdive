import { withBrowser } from "@/server/browser";
import { createLogger } from "@/server/logger";
import type { ColourSample, LogoCandidate } from "@/lib/brand/organisation";

const log = createLogger("discovery:browser");

/**
 * Reading a website the way a visitor reads it.
 *
 * The cheap pass fetches the HTML the server sends and looks at its `<meta>` tags. That is the
 * page as a share-card crawler sees it, and on a modern site it is often close to empty: the
 * header, the logo, the colours and half the copy are written by JavaScript after the document
 * arrives. What comes back is a share banner labelled "logo" and a palette sampled from a favicon.
 *
 * A real browser sees what a person sees. It runs the scripts, applies the stylesheets, and can
 * then be asked concrete questions: which image sits in the header inside the link back home, what
 * colour did the page actually paint, which font did it actually use, what does its structured
 * data say it is. Browserbase runs it when the platform has a key; otherwise it is the Chromium on
 * this machine. Same questions, same answers.
 */

export type PageReading = {
  jsonLd: string[];
  logos: LogoCandidate[];
  colours: ColourSample[];
  fonts: string[];
  socials: string[];
  emails: string[];
  phones: string[];
  lang: string | null;
  title: string | null;
  siteName: string | null;
  description: string | null;
  themeColour: string | null;
  /** The visible words, for the pass that reads rather than parses. Capped: a prompt is not a crawl. */
  text: string;
  /** The header's mark is drawn inline, so there is no address to point a newsletter at. */
  markIsInline: boolean;
};

const NAV_TIMEOUT_MS = 25_000;
const SETTLE_MS = 3500;
const MAX_TEXT_CHARS = 12_000;

/**
 * Runs inside the page.
 *
 * Everything here is answered by measurement — a rectangle, a computed colour, a resolved `src` —
 * rather than by reading the markup and hoping. It must stay self-contained: it is serialised and
 * evaluated in the browser, where none of this file's imports exist.
 */
/* c8 ignore start -- executed inside the browser, covered by the integration test */
function readPage(limits: { maxText: number }) {
  const HEADER_BAND = 900;
  const origin = location.origin;

  const abs = (href: string | null | undefined): string | null => {
    if (!href) return null;
    try {
      const url = new URL(href, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  };

  const hint = (el: Element) =>
    [el.getAttribute("class"), el.getAttribute("id"), el.getAttribute("aria-label"), el.closest("a")?.getAttribute("aria-label")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .slice(0, 300);

  const inHeader = (el: Element) => !!el.closest('header, [role="banner"], nav, [class*="header" i], [id*="header" i], [class*="navbar" i]');

  const linksHome = (el: Element) => {
    const anchor = el.closest("a");
    if (!anchor) return false;
    const href = abs(anchor.getAttribute("href"));
    return !!href && (href === `${origin}/` || href === origin || href === `${location.href.replace(/[?#].*$/, "")}`);
  };

  const logos: Record<string, unknown>[] = [];
  const push = (url: string | null, kind: string, el: Element | null, alt: string, size?: { w: number; h: number }) => {
    if (!url || logos.length > 80) return;
    const rect = el ? el.getBoundingClientRect() : null;
    logos.push({
      url,
      kind,
      alt: (alt || "").slice(0, 200),
      hint: el ? hint(el) : "",
      inHeader: el ? inHeader(el) : false,
      linksHome: el ? linksHome(el) : false,
      width: size ? size.w : rect ? Math.round(rect.width) : 0,
      height: size ? size.h : rect ? Math.round(rect.height) : 0,
      top: rect ? Math.round(rect.top + window.scrollY) : 0,
    });
  };

  // Pictures near the top of the page: where a mark lives, and where a hero photograph also lives,
  // which is why the ranking that follows cares about shape and naming rather than position alone.
  for (const img of Array.from(document.images).slice(0, 120)) {
    const rect = img.getBoundingClientRect();
    if (rect.top + window.scrollY > HEADER_BAND) continue;
    push(abs(img.currentSrc || img.getAttribute("src")), "img", img, img.getAttribute("alt") ?? "");
  }

  let markIsInline = false;
  for (const el of Array.from(document.querySelectorAll("header *, nav *, [role='banner'] *")).slice(0, 600)) {
    const rect = el.getBoundingClientRect();
    if (rect.top + window.scrollY > HEADER_BAND || rect.width < 12 || rect.height < 8) continue;
    const background = getComputedStyle(el).backgroundImage;
    const found = background && background !== "none" ? /url\(["']?([^"')]+)["']?\)/.exec(background) : null;
    if (found) push(abs(found[1]), "background", el, "");
    if (el.tagName.toLowerCase() === "svg" && rect.width >= 24 && (linksHome(el) || /logo|brand|wordmark/.test(hint(el)))) markIsInline = true;
  }

  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"], link[rel="mask-icon"]'))) {
    const sizes = /(\d+)x(\d+)/.exec(link.getAttribute("sizes") ?? "");
    const side = sizes ? Number(sizes[1]) : 64;
    push(abs(link.getAttribute("href")), "icon", null, "icon", { w: side, h: side });
  }

  // What the page actually painted. Background covers area directly; a text colour covers a
  // fraction of the box it sits in, so it is counted at a fraction of that box.
  const colours: Record<string, number> = {};
  const addColour = (value: string, area: number) => {
    const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(value);
    if (!rgb) return;
    if (rgb[4] !== undefined && Number(rgb[4]) < 0.5) return;
    const hex = `#${[rgb[1], rgb[2], rgb[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
    colours[hex] = (colours[hex] ?? 0) + area;
  };
  for (const el of Array.from(document.querySelectorAll("body *")).slice(0, 2500)) {
    const rect = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(rect.width, 2000)) * Math.max(0, Math.min(rect.height, 2000));
    if (area < 120) continue;
    const style = getComputedStyle(el);
    addColour(style.backgroundColor, area);
    addColour(style.color, area * 0.15);
    if (style.borderTopWidth !== "0px") addColour(style.borderTopColor, area * 0.05);
  }

  const family = (selector: string) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const first = getComputedStyle(el).fontFamily.split(",")[0]?.replace(/["']/g, "").trim();
    return first || null;
  };

  const meta = (key: string) =>
    document.querySelector<HTMLMetaElement>(`meta[property="${key}"], meta[name="${key}"]`)?.content?.trim() || null;

  const hrefs = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => a.getAttribute("href") ?? "");
  const text = (document.body?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, limits.maxText);

  return {
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((node) => (node.textContent ?? "").trim())
      .filter(Boolean)
      .slice(0, 12),
    logos,
    colours: Object.entries(colours).map(([hex, area]) => ({ hex, area })),
    fonts: [family("h1"), family("h2"), family("body"), family("nav a"), family("p")].filter(Boolean) as string[],
    socials: hrefs.filter((href) => /^https?:\/\//i.test(href)).slice(0, 400),
    emails: hrefs.filter((href) => href.toLowerCase().startsWith("mailto:")).map((href) => href.slice(7).split("?")[0]).slice(0, 10),
    phones: hrefs.filter((href) => href.toLowerCase().startsWith("tel:")).map((href) => href.slice(4)).slice(0, 10),
    lang: document.documentElement.getAttribute("lang"),
    title: document.title || null,
    siteName: meta("og:site_name"),
    description: meta("og:description") ?? meta("description"),
    themeColour: meta("theme-color"),
    text,
    markIsInline,
  };
}
/* c8 ignore stop */

/** The in-page script, exported so a test can run it against a fixture without leaving the process. */
export const READ_PAGE_SCRIPT = readPage;

/**
 * Opens the page in a real browser and asks it the questions above.
 *
 * Never throws: a customer whose site refuses a headless browser, or takes thirty seconds, or is
 * simply down, must still get the cheap reading rather than an error on the screen. The caller
 * merges whatever comes back over what it already had.
 */
export async function readSiteWithBrowser(url: URL): Promise<PageReading | null> {
  try {
    return await withBrowser(async (browser) => {
      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (compatible; BrieflyBot/1.0; +https://briefly.press/bot)",
        viewport: { width: 1440, height: 1000 },
        locale: "en-US",
        javaScriptEnabled: true,
      });
      context.setDefaultTimeout(NAV_TIMEOUT_MS);
      try {
        const page = await context.newPage();
        // A website is read, never used: nothing is downloaded, and a page that tries to open a
        // dialog does not get to hold the read open until it times out.
        page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
        await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
        await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => {});
        return (await page.evaluate(readPage, { maxText: MAX_TEXT_CHARS })) as PageReading;
      } finally {
        await context.close().catch(() => {});
      }
    });
  } catch (err) {
    log.warn("could not read the site with a browser", { url: url.origin, err });
    return null;
  }
}
