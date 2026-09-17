import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { createLogger } from "@/server/logger";
import { ValidationError } from "@/lib/action-result";

const log = createLogger("discovery");

/**
 * Organisation discovery.
 *
 * Onboarding asks for one thing — a website — and works out the rest. What we read is the public
 * home page and the metadata a site already publishes for social sharing: name, description, logo,
 * theme colour, and the links it gives to its own social profiles.
 *
 * We deliberately do *not* scrape LinkedIn, Instagram or X. Their terms forbid it, and the links
 * alone are what onboarding actually needs; the customer can connect those accounts properly later.
 */

export type DiscoveredOrganization = {
  url: string;
  name: string | null;
  description: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  colours: string[];
  links: { website: string; linkedin?: string; instagram?: string; x?: string; youtube?: string; facebook?: string };
  type: OrganizationTypeGuess;
  locale: "en" | "fr";
  /** What could not be read, so the UI can ask for it instead of guessing silently. */
  missing: string[];
};

type OrganizationTypeGuess = "COMPANY" | "SCHOOL" | "UNIVERSITY" | "ASSOCIATION" | "COMMUNITY" | "INVESTOR" | "MEDIA" | "INSTITUTION" | "OTHER";

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 4_000_000;

/** Reserved ranges. A URL typed into onboarding must not become a probe of our own network. */
function isPrivateAddress(address: string) {
  if (address.includes(":")) {
    const a = address.toLowerCase();
    return a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80") || a.startsWith("::ffff:");
  }
  const [a, b] = address.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function normaliseWebsite(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new ValidationError("Enter your website", { website: ["Required"] });
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ValidationError("That does not look like a website address", { website: ["Enter a URL like acme.com"] });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Only http and https addresses are supported", { website: ["Unsupported address"] });
  }
  if (!url.hostname.includes(".")) throw new ValidationError("Enter a full domain, e.g. acme.com", { website: ["Incomplete domain"] });
  return url;
}

async function assertPublicHost(url: URL) {
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new ValidationError("That address is not reachable from the internet", { website: ["Use a public website"] });
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new ValidationError("That address is not reachable from the internet", { website: ["Use a public website"] });
    return;
  }
  try {
    const records = await lookup(host, { all: true });
    if (records.some((r) => isPrivateAddress(r.address))) {
      throw new ValidationError("That address is not reachable from the internet", { website: ["Use a public website"] });
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError("We could not find that website", { website: ["Check the address"] });
  }
}

async function fetchText(url: URL): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": "BrieflyBot/1.0 (+https://briefly.press/bot)", accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new ValidationError(`The website answered ${res.status}`, { website: ["Could not read the site"] });
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    chunks.push(value);
    if (size > MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

function decodeEntities(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .trim();
}

/** Read one `<meta>` value by property or name, whichever the page happens to use. */
function meta(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return null;
}

function linkHref(html: string, rels: string[]): string | null {
  for (const rel of rels) {
    const m = html.match(new RegExp(`<link[^>]+rel=["'][^"']*${rel}[^"']*["'][^>]*href=["']([^"']+)["']`, "i")) ?? html.match(new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*${rel}[^"']*["']`, "i"));
    if (m?.[1]) return m[1];
  }
  return null;
}

function absolute(base: URL, href: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

const SOCIAL_PATTERNS: [keyof DiscoveredOrganization["links"], RegExp][] = [
  ["linkedin", /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|school|in)\/[A-Za-z0-9\-_%.]+/i],
  ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._]+/i],
  ["x", /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+/i],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:@[A-Za-z0-9._-]+|c\/[A-Za-z0-9._-]+|channel\/[A-Za-z0-9._-]+)/i],
  ["facebook", /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9.\-]+/i],
];

const TYPE_HINTS: [OrganizationTypeGuess, RegExp][] = [
  ["UNIVERSITY", /\b(university|université|universität|faculty|campus life|undergraduate|postgraduate)\b/i],
  ["SCHOOL", /\b(school|école|ecole|college|lycée|academy|students?)\b/i],
  ["INVESTOR", /\b(venture capital|ventures|capital partners|portfolio compan|private equity|fonds d'investissement|investors?)\b/i],
  ["MEDIA", /\b(newsroom|magazine|editorial team|journalis|our reporters)\b/i],
  ["ASSOCIATION", /\b(association|nonprofit|non-profit|charity|ngo|foundation)\b/i],
  ["COMMUNITY", /\b(community|members? club|collective)\b/i],
  ["INSTITUTION", /\b(ministry|government|municipal|public institution|agency)\b/i],
];

function guessType(html: string, description: string | null): OrganizationTypeGuess {
  const haystack = `${description ?? ""} ${html.slice(0, 40_000).replace(/<[^>]+>/g, " ")}`;
  for (const [type, re] of TYPE_HINTS) if (re.test(haystack)) return type;
  return "COMPANY";
}

function guessLocale(html: string): "en" | "fr" {
  const lang = html.match(/<html[^>]+lang=["']([a-zA-Z-]+)["']/i)?.[1]?.toLowerCase();
  return lang?.startsWith("fr") ? "fr" : "en";
}

function normaliseHex(value: string | null): string | null {
  if (!value) return null;
  const hex = value.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  const body = hex[1];
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  return `#${full.toLowerCase()}`;
}

/**
 * Pull a small palette out of an image.
 *
 * Frequency alone gives the wrong answer: the most common pixels in a share banner are its
 * background, so a brand with one vivid accent comes back as four shades of off-white. A brand
 * colour is the *saturated* one, even when it covers a fraction of the image, so buckets are
 * scored by coverage weighted by saturation. Near-white, near-black and flat greys are dropped —
 * every logo has them and none of them identifies anybody.
 */
async function paletteFromImage(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "user-agent": "BrieflyBot/1.0" } });
    if (!res.ok) return [];
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) return [];
    const { data, info } = await sharp(buffer, { failOn: "none" })
      .resize(64, 64, { fit: "inside" })
      .flatten({ background: "#ffffff" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += info.channels) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max > 240 && min > 240) continue; // paper
      if (max < 24) continue; // ink
      if (max - min < 24) continue; // grey at any lightness
      const key = `${Math.round(r / 32)}-${Math.round(g / 32)}-${Math.round(b / 32)}`;
      const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bucket.n += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
    const total = [...buckets.values()].reduce((n, b) => n + b.n, 0);
    if (!total) return [];
    const ranked = [...buckets.values()]
      .map(({ n, r, g, b }) => {
        const rgb: [number, number, number] = [r / n, g / n, b / n];
        const saturation = (Math.max(...rgb) - Math.min(...rgb)) / 255;
        return { rgb, hex: `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`, score: (n / total) * (0.25 + saturation) };
      })
      .sort((a, b) => b.score - a.score);

    // Four shades of the same blue is one brand colour shown four times. Keep only colours that
    // are visibly different from the ones already picked.
    const distinct: typeof ranked = [];
    for (const candidate of ranked) {
      const tooClose = distinct.some((kept) => Math.hypot(...kept.rgb.map((v, i) => v - candidate.rgb[i]) as [number, number, number]) < 72);
      if (!tooClose) distinct.push(candidate);
      if (distinct.length === 4) break;
    }
    return distinct.map((c) => c.hex);
  } catch (err) {
    log.warn("palette extraction failed", { url, err });
    return [];
  }
}

export async function discoverOrganization(rawWebsite: string): Promise<DiscoveredOrganization> {
  const url = normaliseWebsite(rawWebsite);
  await assertPublicHost(url);
  const html = await fetchText(url);

  const title = meta(html, "og:site_name") ?? meta(html, "og:title") ?? decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
  // Site titles are usually "Acme — We build things"; the organisation is the part before the dash.
  const name = title ? (title.split(/\s+[|·—–-]\s+/)[0] || title).slice(0, 120).trim() || null : null;
  const description = meta(html, "og:description") ?? meta(html, "description");

  const logoUrl = absolute(url, meta(html, "og:image") ?? linkHref(html, ["apple-touch-icon"]));
  const faviconUrl = absolute(url, linkHref(html, ["apple-touch-icon", "icon", "shortcut icon"]) ?? "/favicon.ico");

  const links: DiscoveredOrganization["links"] = { website: url.origin };
  for (const [key, re] of SOCIAL_PATTERNS) {
    const found = html.match(re)?.[0];
    if (found) links[key] = found;
  }

  const themeColour = normaliseHex(meta(html, "theme-color"));
  // An icon is the logo on its own; a share banner is the logo inside a layout, so it is only worth
  // reading when the icon gave us nothing.
  const fromIcon = await paletteFromImage(faviconUrl ?? `${url.origin}/favicon.ico`);
  const palette = fromIcon.length || !logoUrl ? fromIcon : await paletteFromImage(logoUrl);
  const colours = [...new Set([themeColour, ...palette].filter((c): c is string => !!c))].slice(0, 4);

  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!description) missing.push("description");
  if (!logoUrl) missing.push("logo");
  if (!colours.length) missing.push("colours");

  return {
    url: url.origin,
    name,
    description: description?.slice(0, 400) ?? null,
    logoUrl,
    faviconUrl,
    colours,
    links,
    type: guessType(html, description),
    locale: guessLocale(html),
    missing,
  };
}
