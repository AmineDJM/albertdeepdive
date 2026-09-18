import { and, eq, ne } from "drizzle-orm";
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
});

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
      subscribeSlug: `${org?.slug ?? "workspace"}-${slug}`,
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
  if (input.name && input.name !== existing.name) patch.slug = await uniqueSlug(organizationId, input.name, id);
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

export async function deletePublication(organizationId: string, id: string, userId?: string | null) {
  const existing = await db.query.publications.findFirst({ where: and(eq(s.publications.id, id), eq(s.publications.organizationId, organizationId)) });
  if (!existing) throw new NotFoundError("Publication");
  // Deleting a title would orphan its editions and silently drop its subscribers. Archiving keeps
  // the archive readable and the record of who was reading it.
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.publicationId, id), columns: { id: true } });
  if (edition) throw new ValidationError("This title has editions. Archive it instead of deleting it.");
  await db.delete(s.publications).where(eq(s.publications.id, id));
  await audit({ action: "publication.delete", organizationId, userId, entityId: id, metadata: { name: existing.name } });
}
