import { and, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { slugify } from "@/lib/utils";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { OUTPUT_FORMATS } from "@/server/outputs/service";
import { PRICE_CURRENCIES, PRICE_INTERVALS } from "@/lib/payments";
import { onlySent } from "@/lib/zod-patch";
import { ensurePriceFor, readerPaymentsFor, stopChargingReaders } from "@/server/payments/readers";
import { requireLimit } from "@/server/billing/entitlements";
import { normaliseWebsite } from "@/server/tenancy/discovery";

/**
 * Publications — the recurring titles a workspace publishes.
 *
 * The plan limit is enforced here rather than in the server action, so that every caller is
 * covered: the action, the onboarding flow, the API, and a future importer. An action is an
 * authentication boundary, not a business-rule boundary.
 */

export const publicationInputSchema = z.object({
  name: z.string().trim().min(2, "Give the title a name").max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  language: z.enum(["en", "fr"]).default("en"),
  cadence: z.enum(["weekly", "fortnightly", "monthly", "quarterly", "irregular"]).default("monthly"),
  defaultFormats: z.array(z.enum(OUTPUT_FORMATS)).min(1, "Choose at least one format"),
  isPublic: z.boolean().default(true),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("ACTIVE"),
  /** Whether readers pay, and what. A paid title needs the workspace's own Stripe account connected. */
  access: z.enum(["free", "paid"]).default("free"),
  priceCents: z.number().int().min(50, "At least 0.50").max(100_000_000).nullable().optional(),
  priceCurrency: z.enum(PRICE_CURRENCIES).default("eur"),
  priceInterval: z.enum(PRICE_INTERVALS).default("month"),
  /** The newsletter's own website, or a public social media page, that its look is read from. */
  website: z.string().trim().max(500).optional().nullable(),
});

/** "acme.com/news" → "https://acme.com/news"; empty stays empty. Refused when it is not an address. */
function cleanWebsite(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return normaliseWebsite(trimmed).toString();
}

/** A title may only charge when there is an account to charge into, and a price to charge. */
async function assertChargeable(organizationId: string, priceCents: number | null | undefined) {
  if (!(await readerPaymentsFor(organizationId))) {
    throw new ValidationError("Connect your Stripe account before charging for a title", { access: ["Settings → Reader payments"] });
  }
  if (!priceCents || priceCents <= 0) throw new ValidationError("A paid title needs a price", { priceCents: ["Enter what a subscription costs"] });
}

export type PublicationInput = z.input<typeof publicationInputSchema>;

/** Slugs are part of the public subscribe link, so they stay unique within the workspace. */
async function uniqueSlug(organizationId: string, name: string, excludeId?: string) {
  const base = slugify(name) || "title";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await db.query.publications.findFirst({
      where: excludeId
        ? and(eq(s.publications.organizationId, organizationId), eq(s.publications.slug, candidate), ne(s.publications.id, excludeId))
        : and(eq(s.publications.organizationId, organizationId), eq(s.publications.slug, candidate)),
      columns: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function createPublication(organizationId: string, raw: PublicationInput, userId?: string | null) {
  const input = publicationInputSchema.parse(raw);
  await requireLimit(organizationId, "publications");
  const slug = await uniqueSlug(organizationId, input.name);
  if (input.access === "paid") await assertChargeable(organizationId, input.priceCents);
  const org = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { slug: true } });
  const [row] = await db
    .insert(s.publications)
    .values({
      organizationId,
      name: input.name,
      slug,
      description: input.description ?? null,
      language: input.language,
      cadence: input.cadence,
      defaultFormats: input.defaultFormats,
      isPublic: input.isPublic,
      status: input.status,
      access: input.access,
      priceCents: input.access === "paid" ? (input.priceCents ?? null) : null,
      priceCurrency: input.priceCurrency,
      priceInterval: input.priceInterval,
      website: cleanWebsite(input.website),
      subscribeSlug: `${org?.slug ?? "workspace"}-${slug}`,
      // The same handle on both doors: /s/… to read it, /c/… to write for it.
      joinSlug: `${org?.slug ?? "workspace"}-${slug}`,
      createdById: userId ?? null,
    })
    .returning();
  if (row.access === "paid") await ensurePriceFor(row);
  await audit({ action: "publication.create", organizationId, userId, entityId: row.id, metadata: { name: input.name, access: row.access } });
  return row;
}

export async function updatePublication(organizationId: string, id: string, raw: Partial<PublicationInput>, userId?: string | null) {
  const existing = await db.query.publications.findFirst({ where: and(eq(s.publications.id, id), eq(s.publications.organizationId, organizationId)) });
  if (!existing) throw new NotFoundError("Publication");
  // zod fills a partial parse with the schema's defaults, and a default is not a change: only
  // what the caller actually sent may overwrite what is there. Otherwise renaming a title would
  // quietly reset its language, its cadence and whether it charges.
  const input = onlySent(publicationInputSchema.partial().parse(raw), raw);
  const patch: Record<string, unknown> = { ...input };
  if (input.website !== undefined) patch.website = cleanWebsite(input.website);
  /*
   * Renaming changes what readers see. It must not change where they go.
   *
   * The slug followed the name, so every rename silently reissued the newsletter's public address
   * — the subscription link in an email somebody sent last month, the page a reader bookmarked,
   * the QR code on a poster. A newsletter you are told you can rename freely, that breaks its own
   * links when you do, is not one you can rename freely.
   *
   * So the address follows the name only while nobody could be holding it: no reader has
   * subscribed and nothing has been published. After that the name is yours to change and the
   * address is fixed, which is the same bargain every publication on the web makes.
   */
  if (input.name && input.name !== existing.name) {
    const [[readers], [published]] = await Promise.all([
      db.select({ n: count() }).from(s.publicationSubscriptions).where(eq(s.publicationSubscriptions.publicationId, id)),
      db.select({ n: count() }).from(s.editions).where(and(eq(s.editions.publicationId, id), inArray(s.editions.status, ["PUBLISHED", "ARCHIVED"]))),
    ]);
    const outInTheWorld = Number(readers?.n ?? 0) > 0 || Number(published?.n ?? 0) > 0;
    if (!outInTheWorld) patch.slug = await uniqueSlug(organizationId, input.name, id);
  }
  const next = { ...existing, ...input };
  if (next.access === "paid") await assertChargeable(organizationId, next.priceCents);
  else if (input.access === "free") patch.priceCents = null;
  const [row] = await db.update(s.publications).set(patch).where(eq(s.publications.id, id)).returning();
  // The price lives in the customer's Stripe as well as here. Created or replaced when it changes;
  // a title that goes free stops charging everybody, at the end of what they paid for.
  if (row.access === "paid") await ensurePriceFor(row);
  if (existing.access === "paid" && row.access === "free") await stopChargingReaders(row.id);
  await audit({ action: "publication.update", organizationId, userId, entityId: id, metadata: { fields: Object.keys(patch) } });
  return row;
}

/**
 * Deleting a title, and deciding what that means for its issues.
 *
 * An edition's link to its title is `set null` rather than a cascade, which is the right shape —
 * an issue that was published is a thing that happened, and it should not vanish because somebody
 * tidied up the list of titles. So the default is to refuse, and say how many issues are in the
 * way rather than "this title has editions".
 *
 * `withEditions` is the other answer, and a person is entitled to it: a newsletter started by
 * mistake, tried for two months and abandoned, is theirs to remove entirely. It goes through
 * `deleteEditions`, which knows what an edition drags with it — the stories, the campaign, the
 * rendered PDFs and the files contributors sent — because deleting the rows and leaving the
 * objects in the bucket is how a storage bill outlives the thing it was for.
 */
export async function deletePublication(
  organizationId: string,
  id: string,
  userId?: string | null,
  opts: { withEditions?: boolean } = {},
): Promise<{ editionsDeleted: number }> {
  const existing = await db.query.publications.findFirst({ where: and(eq(s.publications.id, id), eq(s.publications.organizationId, organizationId)) });
  if (!existing) throw new NotFoundError("Publication");
  const editions = await db.query.editions.findMany({ where: eq(s.editions.publicationId, id), columns: { id: true } });
  if (editions.length && !opts.withEditions) {
    throw new ValidationError(
      editions.length === 1
        ? "This newsletter has 1 edition. Delete it with its edition, or archive the newsletter instead."
        : `This newsletter has ${editions.length} editions. Delete it with them, or archive it instead.`,
      { editions: [String(editions.length)] },
    );
  }
  let editionsDeleted = 0;
  if (editions.length) {
    const { deleteEditions } = await import("@/server/editions/service");
    editionsDeleted = await deleteEditions(
      editions.map((edition) => edition.id),
      userId,
    );
  }
  await db.delete(s.publications).where(eq(s.publications.id, id));
  await audit({ action: "publication.delete", organizationId, userId, entityId: id, metadata: { name: existing.name, editionsDeleted } });
  return { editionsDeleted };
}
