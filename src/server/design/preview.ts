import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { NotFoundError } from "@/lib/action-result";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { brandRecordFor } from "@/server/brand/service";
import { mediaUrls } from "@/server/media/urls";
import { fontCssForUrls } from "@/server/publication/pdf";
import { env } from "@/server/env";
import type { BrandSystem } from "@/lib/brand/system";
import { renderWebEdition } from "./render/web";
import { renderEmailEdition } from "./render/email";
import { directionFor } from "./identity";
import { storedFocals } from "./memory";
import { currentDesign } from "./service";

/** Long enough to read the page, short enough that a link out of it expires. */
const PREVIEW_TTL_SECONDS = 3600;

/**
 * The current design, rendered for a person to look at now.
 *
 * Neither the web edition nor the email needs a browser to produce, so this is a page load rather
 * than a job — which is what makes the controls beside it feel like controls.
 */
export async function previewDesign(editionId: string, medium: "web" | "email"): Promise<string> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition?.organizationId) throw new NotFoundError("Edition");

  const design = await currentDesign(editionId);
  if (!design) return notDesignedYet();

  const document = await buildEditionDocument(editionId, { versionLabel: "design-preview", includeUnapproved: true });
  const publication = edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId) }) : null;
  const [{ resolved: direction }, brand, focals, urls] = await Promise.all([
    directionFor(editionId),
    brandRecordFor({ organizationId: edition.organizationId, publicationId: edition.publicationId }),
    storedFocals(document.media.map((media) => media.id)),
    mediaUrls(document.media.map((media) => media.id), "WEB", PREVIEW_TTL_SECONDS),
  ]);

  const content = { document, medium, urls, focals };
  const locale = publication?.language ?? "en";

  if (medium === "email") {
    return renderEmailEdition({
      design,
      direction,
      brand: brand.system as BrandSystem,
      content,
      locale,
      organizationName: publication?.name ?? document.meta.masthead.title,
      webUrl: null,
      // A preview is not a message: the link is there so the layout is the layout, and it goes
      // nowhere because nobody is unsubscribing from a preview.
      unsubscribeUrl: `${env.NEXT_PUBLIC_APP_URL}/s/unsubscribe/preview`,
    }).html;
  }

  return renderWebEdition({
    design,
    direction,
    brand: brand.system as BrandSystem,
    content,
    locale,
    title: document.meta.masthead.title,
    description: document.meta.cover.standfirst,
    fontCss: fontCssForUrls(env.NEXT_PUBLIC_APP_URL),
  });
}

function notDesignedYet(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not designed yet</title><style>
    body{margin:0;display:grid;place-items:center;min-height:100vh;font:15px/1.5 system-ui,sans-serif;color:#555;background:#fafafa;}
    p{max-width:32ch;text-align:center;}
  </style></head><body><p>This edition has not been designed yet. Design it and the pages will appear here.</p></body></html>`;
}
