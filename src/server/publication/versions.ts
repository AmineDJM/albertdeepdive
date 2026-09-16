import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Browser } from "playwright";
import { db } from "@/server/db/client";
import { editions, notifications, publicationAssets, publicationVersions, qualityGateOverrides } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { getStorage, storageKeys } from "@/server/storage";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES, type JobContext } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { assertTransition, type EditionStatus } from "@/lib/editorial/edition-state";
import { editionDocumentSchema, type EditionDocument } from "@/lib/publication/document";
import { nextVersionLabel, type PublicationKind } from "@/lib/publication/labels";
import { fileSlug } from "@/lib/publication/text";
import { buildEditionDocument, documentHash } from "./document-builder";
import { renderDocx, verifyDocx } from "./docx";
import { renderPdf } from "./pdf";
import { QUALITY_GATE_KEYS, canPublish, exportBlockers, layoutReportAsValidation, validateEditionDocument } from "./validate";

const log = createLogger("publication:versions");

export type PublicationVersionRow = typeof publicationVersions.$inferSelect;
export type PublicationAssetRow = typeof publicationAssets.$inferSelect;
export type RenderLogEntry = { at: string; level: string; message: string };

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function includeUnapprovedFor(kind: PublicationKind) {
  return kind === "DRAFT" || kind === "EDITORIAL_REVIEW";
}

/** Creates the next version row (label v0.<n> for review kinds, v<major>.0 for PUBLISHED) with a snapshot of the document. */
export async function createPublicationVersion(
  editionId: string,
  options: { kind: PublicationKind; userId?: string | null; notes?: string | null },
): Promise<PublicationVersionRow> {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  if (options.kind === "PUBLISHED" && edition.status !== "FINAL_REVIEW" && edition.status !== "PUBLISHED") {
    throw new ValidationError(`A published version can only be created during final review (edition is ${edition.status}).`);
  }
  const existing = await db
    .select({ kind: publicationVersions.kind, sequence: publicationVersions.sequence, label: publicationVersions.label })
    .from(publicationVersions)
    .where(eq(publicationVersions.editionId, editionId));
  const { label, sequence } = nextVersionLabel(options.kind, existing);
  const document = await buildEditionDocument(editionId, { versionLabel: label, includeUnapproved: includeUnapprovedFor(options.kind) });
  const [row] = await db
    .insert(publicationVersions)
    .values({
      editionId,
      label,
      sequence,
      kind: options.kind,
      status: "PENDING",
      document: document as unknown as Record<string, unknown>,
      documentHash: documentHash(document),
      notes: options.notes ?? null,
      createdById: options.userId ?? null,
      renderLog: [{ at: new Date().toISOString(), level: "info", message: `Version ${label} created (${options.kind.toLowerCase()})` }],
    })
    .returning();
  await audit({ action: "publication.version.create", userId: options.userId, entityType: "PUBLICATION_VERSION", entityId: row.id, editionId, metadata: { label, kind: options.kind } });
  log.info("version created", { editionId, versionId: row.id, label });
  return row;
}

/** Creates a version and queues its rendering (EDITION_EXPORT job). */
export async function requestExport(editionId: string, options: { kind: PublicationKind; userId?: string | null; notes?: string | null }) {
  const version = await createPublicationVersion(editionId, options);
  const job = await enqueueJob({
    type: JOB_TYPES.EDITION_EXPORT,
    payload: { versionId: version.id },
    idempotencyKey: `edition.export:${version.id}`,
    editionId,
    createdById: options.userId ?? null,
    maxAttempts: 2,
  });
  kickJobRunner();
  return { version, job };
}

export type RenderVersionOptions = { jobCtx?: JobContext; browser?: Browser };

/**
 * Renders a version: rebuilds the document, validates it (a RED-rights image blocks any export;
 * any error blocks FINAL_REVIEW / PUBLISHED exports), renders the PDF (with the pagination pass)
 * and the DOCX from the same document, stores both assets and updates the version row.
 * Validation failures set status FAILED and return normally; unexpected errors are recorded and rethrown.
 */
export async function renderVersion(versionId: string, options: RenderVersionOptions = {}): Promise<PublicationVersionRow> {
  const version = await db.query.publicationVersions.findFirst({ where: eq(publicationVersions.id, versionId) });
  if (!version) throw new NotFoundError("Publication version");
  if (version.isImmutable) throw new AppError("This version is published and immutable.", "VERSION_IMMUTABLE", 409);
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, version.editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const kind = version.kind as PublicationKind;
  const entries: RenderLogEntry[] = [...(version.renderLog ?? [])];
  const logLine = (message: string, level: "info" | "warn" | "error" = "info", meta?: Record<string, unknown>) => {
    entries.push({ at: new Date().toISOString(), level, message: meta ? `${message} ${JSON.stringify(meta)}` : message });
    log[level](message, { versionId, ...meta });
    options.jobCtx?.log(message, meta);
  };
  const progress = async (done: number, total: number, message: string) => {
    if (options.jobCtx) await options.jobCtx.progress(done, total, message);
  };

  await db.update(publicationVersions).set({ status: "RENDERING", renderLog: entries }).where(eq(publicationVersions.id, versionId));
  logLine(`Rendering ${version.label} (${kind.toLowerCase()})`);

  try {
    await progress(0, 10, "Building the edition document");
    const document = await buildEditionDocument(edition.id, { versionLabel: version.label, includeUnapproved: includeUnapprovedFor(kind) });
    const hash = documentHash(document);
    const validation = validateEditionDocument(document, { kind });
    logLine(`Validation: ${validation.stats?.errors ?? 0} error(s), ${validation.stats?.warnings ?? 0} warning(s)`);
    const blockers = exportBlockers(validation, kind);
    if (blockers.length) {
      logLine(`Export blocked by ${blockers.length} issue(s): ${blockers.map((b) => b.code).join(", ")}`, "error");
      const [failed] = await db
        .update(publicationVersions)
        .set({ status: "FAILED", document: document as unknown as Record<string, unknown>, documentHash: hash, validationReport: validation, renderLog: entries, completedAt: new Date() })
        .where(eq(publicationVersions.id, versionId))
        .returning();
      await notify(version.createdById, "EXPORT_FAILED", `Export ${version.label} blocked`, `${blockers[0].message}${blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ""}`, edition.id, versionId);
      await audit({ action: "publication.version.failed", userId: version.createdById, entityType: "PUBLICATION_VERSION", entityId: versionId, editionId: edition.id, metadata: { blockers: blockers.map((b) => b.code) } });
      return failed;
    }

    await progress(1, 10, "Rendering PDF");
    const pdf = await renderPdf(document, {
      browser: options.browser,
      log: (message, level, meta) => logLine(message, level, meta),
      onProgress: (done, total, message) => progress(1 + Math.round((done / total) * 6), 10, message),
    });
    await progress(8, 10, "Rendering DOCX");
    const docx = await renderDocx(document, { log: (message, level, meta) => logLine(message, level, meta) });
    const verified = verifyDocx(docx, document.meta.cover.headline ?? undefined);
    if (!verified.ok) throw new Error(`DOCX verification failed: ${verified.error}`);

    await progress(9, 10, "Storing files");
    const storage = getStorage();
    const base = `albert-deep-dive-${fileSlug(edition.slug)}-${version.label}`;
    const pdfName = `${base}.pdf`;
    const docxName = `${base}.docx`;
    const pdfKey = storageKeys.publication(edition.id, versionId, pdfName);
    const docxKey = storageKeys.publication(edition.id, versionId, docxName);
    await storage.put(pdfKey, pdf.buffer, { contentType: PDF_MIME, cacheControl: "private, max-age=0" });
    await storage.put(docxKey, docx, { contentType: DOCX_MIME, cacheControl: "private, max-age=0" });
    await db.delete(publicationAssets).where(eq(publicationAssets.versionId, versionId));
    const [pdfAsset, docxAsset] = await db
      .insert(publicationAssets)
      .values([
        { versionId, editionId: edition.id, kind: "PDF", storageKey: pdfKey, fileName: pdfName, mimeType: PDF_MIME, sizeBytes: pdf.buffer.length, pageCount: pdf.pageCount, checksum: sha256(pdf.buffer) },
        { versionId, editionId: edition.id, kind: "DOCX", storageKey: docxKey, fileName: docxName, mimeType: DOCX_MIME, sizeBytes: docx.length, pageCount: null, checksum: sha256(docx) },
      ])
      .returning();
    const layoutReport = layoutReportAsValidation(pdf.layoutReport);
    logLine(`PDF ${pdf.pageCount} pages (${pdf.layoutReport.continuationPagesAdded} continuation page(s)), DOCX ${Math.round(docx.length / 1024)} kB`);
    const [ready] = await db
      .update(publicationVersions)
      .set({
        status: "READY",
        document: pdf.finalDocument as unknown as Record<string, unknown>,
        documentHash: hash,
        validationReport: validation,
        layoutReport,
        pdfAssetId: pdfAsset.id,
        docxAssetId: docxAsset.id,
        renderLog: entries,
        completedAt: new Date(),
      })
      .where(eq(publicationVersions.id, versionId))
      .returning();
    await progress(10, 10, "Export ready");
    await notify(version.createdById, "EXPORT_COMPLETED", `Export ${version.label} is ready`, `${pdf.pageCount}-page PDF and DOCX for ${edition.title}.`, edition.id, versionId);
    await audit({ action: "publication.version.render", userId: version.createdById, entityType: "PUBLICATION_VERSION", entityId: versionId, editionId: edition.id, metadata: { label: version.label, pages: pdf.pageCount, pdfBytes: pdf.buffer.length, docxBytes: docx.length, layoutOk: layoutReport.ok } });
    return ready;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logLine(`Render failed: ${message}`, "error");
    await db.update(publicationVersions).set({ status: "FAILED", renderLog: entries, completedAt: new Date() }).where(eq(publicationVersions.id, versionId));
    await notify(version.createdById, "EXPORT_FAILED", `Export ${version.label} failed`, message.slice(0, 500), edition.id, versionId);
    throw err;
  }
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function notify(userId: string | null, type: "EXPORT_COMPLETED" | "EXPORT_FAILED", title: string, body: string, editionId: string, versionId: string) {
  if (!userId) return;
  try {
    await db.insert(notifications).values({ userId, type, title, body, entityType: "PUBLICATION_VERSION", entityId: versionId, href: `/editions/${editionId}/exports` });
  } catch (err) {
    log.warn("notification insert failed", { err });
  }
}

export async function listVersions(editionId: string): Promise<(PublicationVersionRow & { assets: PublicationAssetRow[] })[]> {
  const rows = await db.select().from(publicationVersions).where(eq(publicationVersions.editionId, editionId)).orderBy(desc(publicationVersions.sequence));
  const assets = rows.length ? await db.select().from(publicationAssets).where(inArray(publicationAssets.versionId, rows.map((r) => r.id))).orderBy(asc(publicationAssets.kind)) : [];
  return rows.map((r) => ({ ...r, assets: assets.filter((a) => a.versionId === r.id) }));
}

export async function getVersion(versionId: string): Promise<(PublicationVersionRow & { assets: PublicationAssetRow[] }) | null> {
  const row = await db.query.publicationVersions.findFirst({ where: eq(publicationVersions.id, versionId) });
  if (!row) return null;
  const assets = await db.select().from(publicationAssets).where(eq(publicationAssets.versionId, versionId)).orderBy(asc(publicationAssets.kind));
  return { ...row, assets };
}

/** Parses a stored version document back into the typed model (null when the version has no document). */
export function documentOfVersion(row: Pick<PublicationVersionRow, "document">): EditionDocument | null {
  if (!row.document) return null;
  const parsed = editionDocumentSchema.safeParse(row.document);
  return parsed.success ? parsed.data : null;
}

export type VersionComparison = {
  articlesAdded: { articleId: string; headline: string }[];
  articlesRemoved: { articleId: string; headline: string }[];
  headlineChanges: { articleId: string; from: string; to: string }[];
  pageCountChange: number;
  wordCountChange: number;
};

export async function compareVersions(aId: string, bId: string): Promise<VersionComparison> {
  const [a, b] = await Promise.all([getVersion(aId), getVersion(bId)]);
  if (!a || !b) throw new NotFoundError("Publication version");
  const docA = documentOfVersion(a);
  const docB = documentOfVersion(b);
  if (!docA || !docB) throw new AppError("Both versions need a stored document to be compared.", "VERSION_NO_DOCUMENT", 409);
  const byIdA = new Map(docA.articles.map((x) => [x.id, x]));
  const byIdB = new Map(docB.articles.map((x) => [x.id, x]));
  const articlesAdded = docB.articles.filter((x) => !byIdA.has(x.id)).map((x) => ({ articleId: x.id, headline: x.headline }));
  const articlesRemoved = docA.articles.filter((x) => !byIdB.has(x.id)).map((x) => ({ articleId: x.id, headline: x.headline }));
  const headlineChanges = docB.articles
    .filter((x) => byIdA.has(x.id) && byIdA.get(x.id)!.headline !== x.headline)
    .map((x) => ({ articleId: x.id, from: byIdA.get(x.id)!.headline, to: x.headline }));
  const words = (doc: EditionDocument) => doc.articles.reduce((n, x) => n + x.wordCount, 0);
  return { articlesAdded, articlesRemoved, headlineChanges, pageCountChange: docB.pages.length - docA.pages.length, wordCountChange: words(docB) - words(docA) };
}

/** Signed download URL for a stored asset (1 h), with the file name for the browser. */
export async function downloadUrl(assetId: string): Promise<{ url: string; fileName: string; mimeType: string }> {
  const asset = await db.query.publicationAssets.findFirst({ where: eq(publicationAssets.id, assetId) });
  if (!asset) throw new NotFoundError("Publication asset");
  const url = await getStorage().getSignedUrl(asset.storageKey, { expiresInSeconds: 3600, download: { fileName: asset.fileName } });
  return { url, fileName: asset.fileName, mimeType: asset.mimeType };
}

/** Publishes an edition from a READY, PUBLISHED-kind version once every blocking quality gate passes. */
export async function publishEdition(editionId: string, versionId: string, userId: string) {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const version = await db.query.publicationVersions.findFirst({ where: eq(publicationVersions.id, versionId) });
  if (!version || version.editionId !== editionId) throw new NotFoundError("Publication version");
  if (version.kind !== "PUBLISHED") throw new ValidationError(`Version ${version.label} is a ${version.kind.toLowerCase()} version; only a PUBLISHED version can be published.`);
  if (version.status !== "READY") throw new ValidationError(`Version ${version.label} is ${version.status.toLowerCase()}; it must be READY.`);
  const gates = await canPublish(editionId);
  if (!gates.ok) {
    throw new AppError(`Quality gates block publication: ${gates.blocking.map((g) => g.label).join(", ")}`, "QUALITY_GATES_BLOCKING", 409);
  }
  assertTransition(edition.status as EditionStatus, "PUBLISHED");
  const now = new Date();
  const [updated] = await db
    .update(editions)
    .set({ status: "PUBLISHED", publishedAt: now, publishedVersionId: versionId, approvedById: userId, approvedAt: edition.approvedAt ?? now })
    .where(eq(editions.id, editionId))
    .returning();
  const [immutable] = await db.update(publicationVersions).set({ isImmutable: true }).where(eq(publicationVersions.id, versionId)).returning();
  await audit({ action: "edition.publish", userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { versionId, label: version.label } });
  log.info("edition published", { editionId, versionId });
  return { edition: updated, version: immutable };
}

export async function archiveEdition(editionId: string, userId: string) {
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  assertTransition(edition.status as EditionStatus, "ARCHIVED");
  const [updated] = await db.update(editions).set({ status: "ARCHIVED", archivedAt: new Date() }).where(eq(editions.id, editionId)).returning();
  await audit({ action: "edition.archive", userId, entityType: "EDITION", entityId: editionId, editionId });
  return updated;
}

const OVERRIDE_ROLES = new Set(["SUPER_ADMIN", "EDITOR_IN_CHIEF"]);

/** Records a quality-gate override (qa:override permission — SUPER_ADMIN / EDITOR_IN_CHIEF only). */
export async function overrideQualityGate(editionId: string, gateKey: string, reason: string, user: { id: string; role: string }) {
  if (!OVERRIDE_ROLES.has(user.role)) throw new ForbiddenError("Only the editor in chief or a super admin can override a quality gate.");
  if (!(QUALITY_GATE_KEYS as readonly string[]).includes(gateKey)) throw new ValidationError(`Unknown quality gate "${gateKey}".`);
  if (!reason.trim()) throw new ValidationError("A reason is required to override a quality gate.");
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const [row] = await db
    .insert(qualityGateOverrides)
    .values({ editionId, gateKey, reason: reason.trim(), userId: user.id })
    .onConflictDoUpdate({ target: [qualityGateOverrides.editionId, qualityGateOverrides.gateKey], set: { reason: reason.trim(), userId: user.id, createdAt: new Date() } })
    .returning();
  await audit({ action: "qa.gate.override", userId: user.id, entityType: "EDITION", entityId: editionId, editionId, metadata: { gateKey, reason: reason.trim() } });
  return row;
}

/** Removes a gate override, so the gate goes back to reflecting the edition's real state. */
export async function clearQualityGateOverride(editionId: string, gateKey: string, user: { id: string; role: string }) {
  if (!OVERRIDE_ROLES.has(user.role)) throw new ForbiddenError("Only the editor in chief or a super admin can lift a quality-gate override.");
  const [row] = await db.delete(qualityGateOverrides).where(and(eq(qualityGateOverrides.editionId, editionId), eq(qualityGateOverrides.gateKey, gateKey))).returning();
  if (!row) throw new NotFoundError("Quality gate override");
  await audit({ action: "qa.gate.override.clear", userId: user.id, entityType: "EDITION", entityId: editionId, editionId, metadata: { gateKey } });
  return row;
}

export type { PublicationKind } from "./validate";
