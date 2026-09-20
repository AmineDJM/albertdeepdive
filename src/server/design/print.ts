import { eq } from "drizzle-orm";
import type { Browser } from "playwright";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { scoped } from "@/server/tenancy/scope";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { ensureBrand } from "@/server/brand/service";
import type { BrandSystem } from "@/lib/brand/system";
import type { EditionDocument } from "@/lib/publication/document";
import type { EditionDesign } from "@/lib/design/model";
import type { PrintOptions } from "@/lib/design/pages";
import { describePlan, planIntegrity } from "@/lib/design/pages";
import { renderDesignPdf, type DesignPdfResult } from "./render/pdf";
import { directionFor } from "./identity";
import { storedFocals } from "./memory";
import { currentDesign, designEdition } from "./service";

/**
 * Printing an edition from its design.
 *
 * The join between the engine and the workspace: which design, which words, which photographs,
 * which brand, which language. Everything it gathers is read under the tenant's scope, because a
 * PDF is a file that leaves the building and a picture from another workspace inside one is not a
 * layout defect.
 */

export type PrintEditionOptions = {
  /** Compose a design first if the edition has never been designed. */
  designIfMissing?: boolean;
  /** Keep the model out of it: the golden tests and the terrain runs need the same pages twice. */
  local?: boolean;
  document?: EditionDocument;
  print?: PrintOptions;
  browser?: Browser;
  maxRounds?: number;
  onProgress?: (done: number, total: number, message: string) => void | Promise<void>;
  /** What the engine did, step by step — the console shows this while an issue is being set. */
  log?: (message: string, meta?: Record<string, unknown>) => void;
};

export type PrintedEdition = DesignPdfResult & {
  design: EditionDesign;
  /** The pages in plain words, for the person watching it happen. */
  summary: string;
  /** Where the paper refused what the design asked for. Empty is the only good answer. */
  integrity: ReturnType<typeof planIntegrity>;
};

export async function printEditionDesign(editionId: string, options: PrintEditionOptions = {}): Promise<PrintedEdition> {
  const edition = await db.query.editions.findFirst({ where: await scoped(s.editions.organizationId, eq(s.editions.id, editionId)) });
  if (!edition?.organizationId) throw new Error(`Edition ${editionId} not found`);

  const existing = await currentDesign(editionId);
  if (!existing && options.designIfMissing === false) throw new Error("This edition has not been designed yet");
  const design = existing ?? (await designEdition(editionId, { local: options.local })).design;

  // The same document the design was composed from, unapproved copy included: a design that
  // references an article the printer cannot see would print a page of gaps.
  const document = options.document ?? (await buildEditionDocument(editionId, { versionLabel: "print", includeUnapproved: true }));
  const publication = edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId) }) : null;
  const [{ resolved: direction }, brand, focals] = await Promise.all([
    directionFor(editionId),
    ensureBrand(edition.organizationId),
    storedFocals(document.media.map((media) => media.id)),
  ]);

  const printed = await renderDesignPdf({
    design,
    document,
    direction,
    brand: brand.system as BrandSystem,
    // The publication chooses the language it is read in; the interface's language is not it.
    locale: publication?.language ?? "en",
    focals,
    print: options.print,
    browser: options.browser,
    maxRounds: options.maxRounds,
    onProgress: options.onProgress,
    log: options.log,
  });

  return { ...printed, design, summary: describePlan(printed.plan), integrity: planIntegrity(design, printed.plan) };
}
