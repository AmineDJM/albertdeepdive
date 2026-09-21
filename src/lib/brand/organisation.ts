/**
 * Making sense of what a website says about the organisation behind it.
 *
 * Pure: it takes strings a page handed over and returns fields. The reading itself — fetch or a
 * real browser — happens elsewhere, so the part with the judgement in it can be tested against
 * awkward real-world markup without a network or a Chromium.
 *
 * The richest source by far is schema.org `Organization`, which a great many sites already publish
 * for search engines: the legal name, the logo as the organisation itself defines it, the
 * description, the social profiles, an address and a contact. It is worth preferring over
 * `og:` tags because it is the organisation describing itself rather than describing a share card.
 */

import { z } from "zod";

export type OrganisationFacts = {
  name: string | null;
  legalName: string | null;
  description: string | null;
  logoUrl: string | null;
  email: string | null;
  telephone: string | null;
  address: string | null;
  foundedYear: number | null;
  /** Profiles the organisation itself claims, from `sameAs`. */
  sameAs: string[];
};

export const EMPTY_FACTS: OrganisationFacts = {
  name: null,
  legalName: null,
  description: null,
  logoUrl: null,
  email: null,
  telephone: null,
  address: null,
  foundedYear: null,
  sameAs: [],
};

const ORG_TYPES = new Set([
  "Organization", "Corporation", "EducationalOrganization", "CollegeOrUniversity", "School",
  "NGO", "NewsMediaOrganization", "LocalBusiness", "GovernmentOrganization", "SportsOrganization",
  "PerformingGroup", "Airline", "Consortium", "ResearchOrganization", "FundingScheme",
]);

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

/** schema.org lets almost every field be a string, an object, or an array of either. */
function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function urlOf(value: unknown): string | null {
  const node = first(value);
  if (typeof node === "string") return node.trim() || null;
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    return text(record.url) ?? text(record.contentUrl) ?? null;
  }
  return null;
}

function addressOf(value: unknown): string | null {
  const node = first(value);
  if (typeof node === "string") return node.trim() || null;
  if (!node || typeof node !== "object") return null;
  const a = node as Record<string, unknown>;
  const parts = [a.streetAddress, a.postalCode, a.addressLocality, a.addressRegion, a.addressCountry]
    .map((part) => text(first(part)))
    .filter((part): part is string => !!part);
  return parts.length ? parts.join(", ") : null;
}

function isOrganisationNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((one) => typeof one === "string" && ORG_TYPES.has(one));
}

/** Every node in a JSON-LD document, `@graph` and nesting included. */
function flatten(value: unknown, into: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 6 || !value) return into;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, into, depth + 1);
    return into;
  }
  if (typeof value !== "object") return into;
  const node = value as Record<string, unknown>;
  into.push(node);
  if (node["@graph"]) flatten(node["@graph"], into, depth + 1);
  if (node.publisher) flatten(node.publisher, into, depth + 1);
  if (node.sourceOrganization) flatten(node.sourceOrganization, into, depth + 1);
  return into;
}

/**
 * What the site's own structured data says it is.
 *
 * Blocks arrive as raw strings because that is what a `<script type="application/ld+json">`
 * contains, and a malformed one is common enough that it must not take the rest down with it.
 */
export function factsFromJsonLd(blocks: string[]): OrganisationFacts {
  const nodes: Record<string, unknown>[] = [];
  for (const block of blocks) {
    try {
      flatten(JSON.parse(block), nodes);
    } catch {
      // A site with broken JSON-LD is a site we read the rest of.
    }
  }
  const org = nodes.find(isOrganisationNode);
  if (!org) return { ...EMPTY_FACTS };

  const founded = text(first(org.foundingDate));
  const year = founded ? Number(founded.slice(0, 4)) : NaN;

  return {
    name: text(first(org.name)),
    legalName: text(first(org.legalName)),
    description: text(first(org.description)),
    logoUrl: urlOf(org.logo) ?? urlOf(org.image),
    email: text(first(org.email))?.replace(/^mailto:/i, "") ?? null,
    telephone: text(first(org.telephone)),
    address: addressOf(org.address),
    foundedYear: Number.isFinite(year) && year > 1000 && year <= new Date().getFullYear() ? year : null,
    sameAs: (Array.isArray(org.sameAs) ? org.sameAs : [org.sameAs])
      .map((one) => text(one))
      .filter((one): one is string => !!one),
  };
}

/**
 * Two readings of the same site, and which one wins per field.
 *
 * Not "the browser wins": the browser is better at some things and no better at others. It sees
 * what a reader sees, so it wins on the logo and on anything a script wrote. For a field both
 * found identically there is nothing to choose. And a field only the cheap pass found is still a
 * field found — preferring an empty browser answer over a real fetched one would make the better
 * reader produce the worse result.
 */
export function mergeFacts(fetched: Partial<OrganisationFacts>, browsed: Partial<OrganisationFacts>): OrganisationFacts {
  const pick = <K extends keyof OrganisationFacts>(key: K): OrganisationFacts[K] => {
    const fromBrowser = browsed[key];
    if (fromBrowser !== undefined && fromBrowser !== null && fromBrowser !== "") return fromBrowser as OrganisationFacts[K];
    const fromFetch = fetched[key];
    if (fromFetch !== undefined && fromFetch !== null && fromFetch !== "") return fromFetch as OrganisationFacts[K];
    return EMPTY_FACTS[key];
  };
  return {
    name: pick("name"),
    legalName: pick("legalName"),
    description: pick("description"),
    logoUrl: pick("logoUrl"),
    email: pick("email"),
    telephone: pick("telephone"),
    address: pick("address"),
    foundedYear: pick("foundedYear"),
    sameAs: [...new Set([...(browsed.sameAs ?? []), ...(fetched.sameAs ?? [])])],
  };
}

/** Which fields a reading actually answered, so the screen can ask for the rest instead of guessing. */
export function whatIsMissing(facts: OrganisationFacts): string[] {
  const missing: string[] = [];
  if (!facts.name) missing.push("name");
  if (!facts.description) missing.push("description");
  if (!facts.logoUrl) missing.push("logo");
  return missing;
}

/**
 * A picture on the page that might be the organisation's mark.
 *
 * A browser can see everything a reader sees, which is the problem: a home page has sixty images
 * and one of them is the logo. What tells them apart is not the picture, it is where the picture
 * sits — top of the page, inside the link back to the home page, named `logo` by the person who
 * built the site, shaped like a wordmark rather than a photograph.
 */
export type LogoCandidate = {
  /** Absolute, or a `data:` URI when the mark was an inline `<svg>` — which most modern sites use. */
  url: string;
  kind: "structured" | "svg" | "img" | "background" | "icon";
  alt: string;
  /** `class`, `id` and `aria-label` joined and lowercased: what the page's author called this thing. */
  hint: string;
  inHeader: boolean;
  linksHome: boolean;
  width: number;
  height: number;
  top: number;
};

/** Things a page puts in its header that are emphatically not the organisation's logo. */
const NOT_A_LOGO = /(social|share|partner|sponsor|payment|visa|mastercard|avatar|flag|cookie|badge|award|certif|app-?store|google-?play)/;
const IS_A_LOGO = /(logo|wordmark|brandmark|\bbrand\b|monogram|isotype)/;

export function scoreLogo(candidate: LogoCandidate): number {
  const named = `${candidate.hint} ${candidate.alt}`.toLowerCase();
  if (NOT_A_LOGO.test(named)) return -1;

  let score = { structured: 7, svg: 4, img: 4, background: 3, icon: 1 }[candidate.kind];
  if (IS_A_LOGO.test(named)) score += 5;
  if (candidate.linksHome) score += 3;
  if (candidate.inHeader) score += 2;
  if (candidate.top >= 0 && candidate.top < 200) score += 2;

  // A mark is a mark: a 2000px-wide hero and a 12px bullet are both something else, and a strip
  // twenty times wider than it is tall is a decorative rule.
  const longest = Math.max(candidate.width, candidate.height);
  const ratio = candidate.width && candidate.height ? Math.max(candidate.width / candidate.height, candidate.height / candidate.width) : 1;
  if (longest && longest < 16) score -= 6;
  if (longest > 900) score -= 4;
  if (ratio > 12) score -= 4;
  return score;
}

/**
 * The candidates worth showing, best first.
 *
 * Deliberately a shortlist rather than an answer. Picking a logo off a page is a judgement about
 * what a brand *is*, and getting it wrong silently — putting a partner's mark on somebody's
 * newsletter — is worse than asking. So the shortlist goes to the screen and a person clicks.
 */
export function rankLogos(candidates: LogoCandidate[], limit = 6): LogoCandidate[] {
  const seen = new Set<string>();
  return candidates
    .map((candidate) => ({ candidate, score: scoreLogo(candidate) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.top - b.candidate.top)
    .filter(({ candidate }) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** A colour the rendered page actually used, and how much of the page it covered. */
export type ColourSample = { hex: string; area: number };

function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The brand colours out of everything the page painted.
 *
 * Area alone answers "white" for every site on earth, and saturation alone answers with whatever
 * tiny red asterisk marks a required field. The colour a brand is recognised by is the saturated
 * one it uses a lot of, so the two are multiplied, and anything that is paper, ink or grey is
 * dropped — every page has those and none of them belongs to anybody.
 */
export function rankColours(samples: ColourSample[], limit = 4): string[] {
  const scored = samples
    .map((sample) => ({ sample, rgb: rgbOf(sample.hex) }))
    .filter((entry): entry is { sample: ColourSample; rgb: [number, number, number] } => !!entry.rgb)
    .filter(({ rgb }) => {
      const max = Math.max(...rgb);
      const min = Math.min(...rgb);
      return !(max > 240 && min > 240) && max >= 24 && max - min >= 24;
    })
    .map(({ sample, rgb }) => ({
      hex: `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`,
      rgb,
      score: Math.sqrt(Math.max(sample.area, 1)) * ((Math.max(...rgb) - Math.min(...rgb)) / 255),
    }))
    .sort((a, b) => b.score - a.score);

  const kept: typeof scored = [];
  for (const candidate of scored) {
    if (kept.some((other) => Math.hypot(...(other.rgb.map((v, i) => v - candidate.rgb[i]) as [number, number, number])) < 72)) continue;
    kept.push(candidate);
    if (kept.length === limit) break;
  }
  return kept.map((c) => c.hex);
}

/**
 * The facts about an organisation that have nowhere else to live.
 *
 * `organizations` has columns for the things Briefly itself uses — name, website, logo, colours.
 * A legal name, a registered address, a switchboard number and a founding year are none of
 * Briefly's business operationally, but they are what an organisation *is*, they appear in
 * footers and imprints, and somebody setting up a newsletter should not have to type them twice.
 * They go in `settings.profile`, which is jsonb, so learning a new fact costs no migration.
 */
export type OrganisationProfile = {
  legalName?: string;
  email?: string;
  telephone?: string;
  address?: string;
  foundedYear?: number;
  industry?: string;
  /** One line the organisation would recognise as a description of itself. */
  headline?: string;
};

export const organisationProfileSchema = z
  .object({
    legalName: z.string().trim().max(200),
    email: z.string().trim().max(200),
    telephone: z.string().trim().max(60),
    address: z.string().trim().max(300),
    foundedYear: z.number().int().min(1000).max(new Date().getFullYear()),
    industry: z.string().trim().max(120),
    headline: z.string().trim().max(300),
  })
  .partial();

/** The profile out of a workspace's `settings` blob, ignoring anything that is not one. */
export function profileFromSettings(settings: unknown): OrganisationProfile {
  const candidate = settings && typeof settings === "object" ? (settings as Record<string, unknown>).profile : null;
  const parsed = organisationProfileSchema.safeParse(candidate ?? {});
  return parsed.success ? parsed.data : {};
}

export function profileFromFacts(facts: OrganisationFacts): OrganisationProfile {
  const profile: OrganisationProfile = {};
  if (facts.legalName) profile.legalName = facts.legalName;
  if (facts.email) profile.email = facts.email;
  if (facts.telephone) profile.telephone = facts.telephone;
  if (facts.address) profile.address = facts.address;
  if (facts.foundedYear) profile.foundedYear = facts.foundedYear;
  return profile;
}
