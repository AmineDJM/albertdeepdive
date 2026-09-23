import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { NotFoundError } from "@/lib/action-result";
import { activePublicationBrand, brandRecordFor, clearPublicationBrand, savePublicationBrandFromEvidence } from "@/server/brand/service";
import { assertPublicHost, discoverNewsletterBrand, normaliseWebsite, type NewsletterBrandReading } from "@/server/tenancy/discovery";
import { ingestMedia, SUPPORTED_IMAGE_MIMES } from "@/server/media/ingest";
import { mediaUrl, LONG_LIVED_IMAGE_TTL_SECONDS } from "@/server/media/urls";
import type { BrandSystem } from "@/lib/brand/system";

const log = createLogger("publications:brand");

const LOGO_TIMEOUT_MS = 10_000;
const MAX_LOGO_BYTES = 4_000_000;

/**
 * A newsletter's own look, read from its own address and worn everywhere it goes out.
 *
 * The address is given when the newsletter is created (or later, on its settings): its website, or
 * a public social media page. What is read there becomes the newsletter's brand — colours, type,
 * mark — built on its organisation's so that whatever could not be read is still the organisation's.
 * The mark is copied into the library rather than pointed at, because an email is opened weeks
 * later and a social network's picture address stops working long before that.
 */

/** Fetch a picture from the open web and keep it in the workspace's library, as the newsletter's mark. */
async function importLogo(organizationId: string, logoUrl: string, source: string, userId: string | null): Promise<string | null> {
  try {
    const url = normaliseWebsite(logoUrl);
    await assertPublicHost(url);
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(LOGO_TIMEOUT_MS), headers: { "user-agent": "BrieflyBot/1.0 (+https://briefly.press/bot)", accept: "image/*" } });
    if (!res.ok) return null;
    const declared = res.headers.get("content-length");
    if (declared && Number(declared) > MAX_LOGO_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.byteLength || buffer.byteLength > MAX_LOGO_BYTES) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? undefined;
    // An SVG mark stays an address: the library keeps raster pictures only.
    if (mimeType && (mimeType.includes("svg") || !(SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mimeType))) return null;
    const { asset } = await ingestMedia({
      buffer,
      fileName: "newsletter-logo",
      mimeType,
      kind: "logo",
      organizationId,
      userId,
      caption: "The newsletter's mark",
      credit: source,
      // Its own mark, taken from its own page.
      rightsStatus: "GREEN",
      rightsNote: `The newsletter's own mark, read from ${source}`,
      skipDuplicateCheck: true,
    });
    return asset.id;
  } catch (err) {
    log.warn("the newsletter's mark could not be kept", { organizationId, logoUrl, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export type NewsletterLookResult = {
  reading: NewsletterBrandReading | null;
  /** Whether the newsletter now wears a look of its own. */
  ownBrand: boolean;
  logoMediaId: string | null;
};

/**
 * Read the newsletter's address and dress the newsletter in what was found.
 *
 * `reading` is passed when the person already saw it on the screen — what they approved is what is
 * saved, and the page is not read twice. With no address the newsletter goes back to its
 * organisation's look. A reading that found nothing to wear changes nothing, and says so.
 */
export async function applyNewsletterLook(
  publicationId: string,
  options: { actorId?: string | null; reading?: NewsletterBrandReading | null } = {},
): Promise<NewsletterLookResult> {
  const publication = await db.query.publications.findFirst({ where: eq(s.publications.id, publicationId), columns: { id: true, organizationId: true, website: true, logoMediaId: true } });
  if (!publication) throw new NotFoundError("Newsletter");
  if (!publication.website) {
    await clearPublicationBrand(publicationId);
    await db.update(s.publications).set({ logoMediaId: null }).where(eq(s.publications.id, publicationId));
    return { reading: null, ownBrand: false, logoMediaId: null };
  }

  const reading = options.reading ?? (await discoverNewsletterBrand(publication.website));
  const found = reading.colours.length > 0 || !!reading.logoUrl || reading.fonts.length > 0;
  if (!found) return { reading, ownBrand: !!(await activePublicationBrand(publicationId)), logoMediaId: publication.logoMediaId };

  const logoMediaId = reading.logoUrl ? await importLogo(publication.organizationId, reading.logoUrl, reading.url, options.actorId ?? null) : null;
  await savePublicationBrandFromEvidence({
    organizationId: publication.organizationId,
    publicationId,
    evidence: { colours: reading.colours, fonts: reading.fonts, logoUrl: reading.logoUrl, type: null },
    source: reading.url,
    actorId: options.actorId ?? null,
  });
  if (logoMediaId) await db.update(s.publications).set({ logoMediaId }).where(eq(s.publications.id, publicationId));
  return { reading, ownBrand: true, logoMediaId: logoMediaId ?? publication.logoMediaId };
}

export type NewsletterLook = {
  name: string;
  /** An address an inbox can load weeks from now, or null for a name-only masthead. */
  logoUrl: string | null;
  colour: string | null;
  brand: BrandSystem;
  /** Whether this is the newsletter's own look or its organisation's. */
  own: boolean;
};

/**
 * What a newsletter looks like on the way out: name, mark, colour, brand.
 *
 * Its own look when one was read from its address, its organisation's otherwise. The mark is the
 * copy in the library, signed for as long as an email can sit unread; the organisation's mark is
 * whatever address the organisation gave.
 */
export async function newsletterLook(scope: { organizationId: string; publicationId?: string | null }): Promise<NewsletterLook> {
  const [organization, publication, record] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(s.organizations.id, scope.organizationId), columns: { name: true, logoUrl: true, brandColours: true } }),
    scope.publicationId
      ? db.query.publications.findFirst({ where: and(eq(s.publications.id, scope.publicationId), eq(s.publications.organizationId, scope.organizationId)), columns: { name: true, logoMediaId: true } })
      : Promise.resolve(undefined),
    brandRecordFor(scope),
  ]);
  const own = !!record.publicationId;
  const brand = record.system as BrandSystem;
  const orgColours = (organization?.brandColours ?? {}) as { primary?: string };
  const storedLogo = own && publication?.logoMediaId ? await mediaUrl(publication.logoMediaId, "WEB", LONG_LIVED_IMAGE_TTL_SECONDS) : null;
  return {
    name: publication?.name?.trim() || organization?.name || "",
    logoUrl: own ? (storedLogo ?? brand.logo.markUrl ?? null) : (organization?.logoUrl ?? null),
    colour: own ? brand.colours.brand : (orgColours.primary ?? null),
    brand,
    own,
  };
}
