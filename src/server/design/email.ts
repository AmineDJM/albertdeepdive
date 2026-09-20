import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { ensureBrand } from "@/server/brand/service";
import type { BrandSystem } from "@/lib/brand/system";
import type { EditionDocument } from "@/lib/publication/document";
import { renderEmailEdition, type RenderedEmail } from "./render/email";
import { directionFor } from "./identity";
import { storedFocals } from "./memory";
import { currentDesign } from "./service";

/**
 * The edition's own design, as the email that goes out.
 *
 * Prepared once and rendered per recipient, because the parts that differ between two readers —
 * the greeting and the unsubscribe link — are the cheap parts, and the parts that do not — the
 * design, the brand, the photographs, the language — are the expensive ones.
 *
 * It returns nothing for an edition that has never been designed. That is deliberate: the send
 * path then uses the renderer it has always used, so introducing this cannot change what an
 * existing title's readers receive until somebody designs an issue.
 */

export type DesignEmailContext = {
  document: EditionDocument;
  /** Absolute, long-lived image URLs by media id. An inbox cannot follow a relative path. */
  imageUrls: Record<string, string>;
  organizationName: string;
  logoUrl?: string | null;
  webUrl?: string | null;
  footerNote?: string | null;
  showBrieflyMark?: boolean;
  locale?: string;
};

export type DesignEmailRenderer = (recipient: { unsubscribeUrl: string; greetingName?: string | null }) => RenderedEmail;

export async function designEmailFor(editionId: string, context: DesignEmailContext): Promise<DesignEmailRenderer | null> {
  const design = await currentDesign(editionId);
  if (!design) return null;

  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition?.organizationId) return null;

  const [{ resolved: direction }, brand, focals] = await Promise.all([
    directionFor(editionId),
    ensureBrand(edition.organizationId),
    storedFocals(context.document.media.map((media) => media.id)),
  ]);

  return (recipient) =>
    renderEmailEdition({
      design,
      direction,
      brand: brand.system as BrandSystem,
      content: { document: context.document, medium: "email", urls: context.imageUrls, focals },
      locale: context.locale ?? "en",
      organizationName: context.organizationName,
      logoUrl: context.logoUrl ?? null,
      webUrl: context.webUrl ?? null,
      unsubscribeUrl: recipient.unsubscribeUrl,
      greetingName: recipient.greetingName ?? null,
      footerNote: context.footerNote ?? null,
      showBrieflyMark: context.showBrieflyMark,
    });
}
