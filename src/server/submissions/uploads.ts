/**
 * Contributor uploads: photos go through the media pipeline (variants, hashes, quality),
 * documents and voice notes are stored as-is. Everything is MIME-sniffed and size-limited.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { mediaAssets, mediaVariants, submissionAttachments } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { createLogger } from "@/server/logger";
import { ingestMedia, sniffMime, SUPPORTED_IMAGE_MIMES } from "@/server/media/ingest";
import { extensionForMime, getStorage, storageKeys } from "@/server/storage";
import { AppError, NotFoundError, ValidationError } from "@/lib/action-result";
import { attachmentMetaSchema, fieldErrorsFromIssues } from "@/lib/submissions/schemas";
import type { AttachmentDTO } from "@/lib/submissions/dto";
import { attachmentDTOs, requireOwnedDraft, toAttachmentDTO } from "./public";

const log = createLogger("submissions:uploads");

export const DOCUMENT_MIMES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
};

export const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/wave",
  "audio/webm",
  "audio/ogg",
  "audio/opus",
]);

const TEXT_MIMES = new Set(["text/csv", "text/plain"]);
const OOXML_BY_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const OOXML_MIMES = new Set(Object.values(OOXML_BY_EXT));

export type UploadInput = { buffer: Buffer; fileName: string; mimeType?: string | null; caption?: string | null; photographer?: string | null };

export type ResolvedKind = { kind: "IMAGE" | "DOCUMENT" | "AUDIO"; mimeType: string };

function looksLikeText(buffer: Buffer) {
  const sample = buffer.subarray(0, 4096);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

function extensionOf(fileName: string) {
  return fileName.toLowerCase().split(".").pop() ?? "";
}

/** Decides what an upload is from its bytes first, then from the declared type for formats without magic numbers. */
export async function classifyUpload(buffer: Buffer, fileName: string, declared: string | null | undefined): Promise<ResolvedKind> {
  const declaredMime = (declared ?? "").split(";")[0].trim().toLowerCase();
  const sniffed = (await sniffMime(buffer, declaredMime || undefined)).toLowerCase();
  const ext = extensionOf(fileName);

  if ((SUPPORTED_IMAGE_MIMES as readonly string[]).includes(sniffed)) return { kind: "IMAGE", mimeType: sniffed };
  if (sniffed === "image/heic" || sniffed === "image/heif" || ext === "heic" || ext === "heif") {
    throw new AppError("HEIC photos are not supported yet — please send a JPEG (iPhone: Settings › Camera › Formats › Most compatible)", "UNSUPPORTED_TYPE", 415);
  }
  if (sniffed.startsWith("image/")) throw new AppError(`Unsupported image format (${sniffed}). Please send a JPEG, PNG or WebP.`, "UNSUPPORTED_TYPE", 415);

  if (sniffed in DOCUMENT_MIMES && !TEXT_MIMES.has(sniffed)) return { kind: "DOCUMENT", mimeType: sniffed };
  if (sniffed === "application/zip" && (OOXML_MIMES.has(declaredMime) || ext in OOXML_BY_EXT)) {
    return { kind: "DOCUMENT", mimeType: OOXML_MIMES.has(declaredMime) ? declaredMime : OOXML_BY_EXT[ext] };
  }
  if (AUDIO_MIMES.has(sniffed)) return { kind: "AUDIO", mimeType: sniffed };
  if (sniffed === "video/webm" && (declaredMime.startsWith("audio/") || ext === "weba")) return { kind: "AUDIO", mimeType: "audio/webm" };
  if (sniffed === "video/mp4" && declaredMime.startsWith("audio/")) return { kind: "AUDIO", mimeType: "audio/mp4" };

  // Plain text formats have no magic number: trust the declared type / extension if the bytes are text.
  const textMime = TEXT_MIMES.has(declaredMime) ? declaredMime : ext === "csv" ? "text/csv" : ext === "txt" || ext === "md" ? "text/plain" : null;
  if (textMime && looksLikeText(buffer)) return { kind: "DOCUMENT", mimeType: textMime };

  throw new AppError(
    "This file type is not supported. Photos (JPEG, PNG, WebP), documents (PDF, Word, PowerPoint, Excel, CSV, text) and voice notes (MP3, M4A, WAV, WebM, OGG) are welcome.",
    "UNSUPPORTED_TYPE",
    415,
  );
}

export async function attachUpload(submissionId: string, rawToken: string, input: UploadInput): Promise<{ attachment: AttachmentDTO }> {
  const { resolved, draft } = await requireOwnedDraft(submissionId, rawToken);
  if (!resolved.canSubmit && resolved.blockedReason && resolved.blockedReason !== "NOT_OPEN") {
    throw new AppError(resolved.blockedReason === "CLOSED" ? "Contributions for this issue are closed" : "This link is no longer active", "CAMPAIGN_CLOSED", 409);
  }
  const maxBytes = env.UPLOAD_MAX_FILE_MB * 1024 * 1024;
  if (!input.buffer.byteLength) throw new ValidationError("The file is empty", { file: ["The file is empty"] });
  if (input.buffer.byteLength > maxBytes) throw new AppError(`Files must be smaller than ${env.UPLOAD_MAX_FILE_MB} MB`, "FILE_TOO_LARGE", 413);
  const existing = await db
    .select({ id: submissionAttachments.id, sortOrder: submissionAttachments.sortOrder })
    .from(submissionAttachments)
    .where(eq(submissionAttachments.submissionId, draft.id));
  if (existing.length >= env.UPLOAD_MAX_FILES_PER_SUBMISSION) throw new AppError(`You can attach up to ${env.UPLOAD_MAX_FILES_PER_SUBMISSION} files per story`, "TOO_MANY_FILES", 409);

  const meta = attachmentMetaSchema.safeParse({ caption: input.caption ?? undefined, photographer: input.photographer ?? undefined });
  if (!meta.success) throw new ValidationError("Invalid caption", fieldErrorsFromIssues(meta.error.issues));
  const fileName = sanitiseFileName(input.fileName);
  const resolvedKind = await classifyUpload(input.buffer, fileName, input.mimeType);
  const sortOrder = existing.reduce((n, a) => Math.max(n, a.sortOrder + 1), 0);
  const storage = getStorage();

  let row: typeof submissionAttachments.$inferSelect;
  let dims: { width: number | null; height: number | null } = { width: null, height: null };
  let thumbnailUrl: string | null = null;

  if (resolvedKind.kind === "IMAGE") {
    const { asset, variants } = await ingestMedia({
      buffer: input.buffer,
      fileName,
      mimeType: resolvedKind.mimeType,
      editionId: draft.editionId,
      submissionId: draft.id,
      contributorId: resolved.contributor.id,
      caption: meta.data.caption || null,
      photographer: meta.data.photographer || null,
      rightsStatus: "YELLOW",
      rightsNote: "Uploaded by the contributor — image rights to confirm at submission.",
    });
    [row] = await db
      .insert(submissionAttachments)
      .values({
        submissionId: draft.id,
        mediaAssetId: asset.id,
        kind: "IMAGE",
        fileName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        storageKey: asset.storageKey,
        caption: meta.data.caption || null,
        photographer: meta.data.photographer || null,
        sortOrder,
      })
      .returning();
    dims = { width: asset.width, height: asset.height };
    const thumb = variants.find((v) => v.kind === "THUMBNAIL");
    thumbnailUrl = thumb ? await storage.getSignedUrl(thumb.storageKey, { expiresInSeconds: 3600 }) : null;
  } else {
    const attachmentId = crypto.randomUUID();
    const key = storageKeys.attachment(draft.id, attachmentId, extensionForMime(resolvedKind.mimeType));
    await storage.put(key, input.buffer, { contentType: resolvedKind.mimeType });
    [row] = await db
      .insert(submissionAttachments)
      .values({
        id: attachmentId,
        submissionId: draft.id,
        kind: resolvedKind.kind,
        fileName,
        mimeType: resolvedKind.mimeType,
        sizeBytes: input.buffer.byteLength,
        storageKey: key,
        caption: meta.data.caption || null,
        photographer: null,
        sortOrder,
      })
      .returning();
  }
  await audit({
    action: "submission.upload",
    actorType: "CONTRIBUTOR",
    entityType: "SUBMISSION",
    entityId: draft.id,
    editionId: draft.editionId,
    metadata: { attachmentId: row.id, kind: row.kind, mimeType: row.mimeType, sizeBytes: row.sizeBytes },
  });
  log.info("upload attached", { submissionId: draft.id, kind: row.kind, mimeType: row.mimeType, sizeBytes: row.sizeBytes });
  return { attachment: toAttachmentDTO(row, dims, thumbnailUrl) };
}

export async function updateUploadMeta(submissionId: string, rawToken: string, attachmentId: string, input: unknown): Promise<{ attachment: AttachmentDTO }> {
  const { draft } = await requireOwnedDraft(submissionId, rawToken);
  const parsed = attachmentMetaSchema.safeParse(input ?? {});
  if (!parsed.success) throw new ValidationError("Invalid caption", fieldErrorsFromIssues(parsed.error.issues));
  const existing = await db.query.submissionAttachments.findFirst({ where: and(eq(submissionAttachments.id, attachmentId), eq(submissionAttachments.submissionId, draft.id)) });
  if (!existing) throw new NotFoundError("Attachment");
  const set: Partial<typeof submissionAttachments.$inferInsert> = {};
  if (parsed.data.caption !== undefined) set.caption = parsed.data.caption || null;
  if (parsed.data.photographer !== undefined) set.photographer = parsed.data.photographer || null;
  const [row] = await db.update(submissionAttachments).set(set).where(eq(submissionAttachments.id, existing.id)).returning();
  if (existing.mediaAssetId) {
    await db
      .update(mediaAssets)
      .set({
        ...(set.caption !== undefined ? { caption: set.caption } : {}),
        ...(set.photographer !== undefined ? { photographer: set.photographer, credit: set.photographer ? `© ${set.photographer}` : null } : {}),
      })
      .where(eq(mediaAssets.id, existing.mediaAssetId));
  }
  const dto = (await attachmentDTOs(draft.id)).find((a) => a.id === row.id);
  if (!dto) throw new NotFoundError("Attachment");
  return { attachment: dto };
}

export async function removeUpload(submissionId: string, rawToken: string, attachmentId: string): Promise<{ ok: true }> {
  const { draft } = await requireOwnedDraft(submissionId, rawToken);
  const existing = await db.query.submissionAttachments.findFirst({ where: and(eq(submissionAttachments.id, attachmentId), eq(submissionAttachments.submissionId, draft.id)) });
  if (!existing) throw new NotFoundError("Attachment");
  const storage = getStorage();
  await db.delete(submissionAttachments).where(eq(submissionAttachments.id, existing.id));
  if (existing.mediaAssetId) {
    const variants = await db.select({ key: mediaVariants.storageKey }).from(mediaVariants).where(eq(mediaVariants.assetId, existing.mediaAssetId));
    await db.delete(mediaAssets).where(eq(mediaAssets.id, existing.mediaAssetId));
    for (const key of [existing.storageKey, ...variants.map((v) => v.key)]) {
      await storage.delete(key).catch((err) => log.warn("could not delete media file", { key, err }));
    }
  } else {
    await storage.delete(existing.storageKey).catch((err) => log.warn("could not delete attachment file", { key: existing.storageKey, err }));
  }
  await audit({ action: "submission.upload_remove", actorType: "CONTRIBUTOR", entityType: "SUBMISSION", entityId: draft.id, editionId: draft.editionId, metadata: { attachmentId, kind: existing.kind } });
  return { ok: true };
}

export async function listUploads(submissionId: string, rawToken: string): Promise<AttachmentDTO[]> {
  const { draft } = await requireOwnedDraft(submissionId, rawToken);
  return attachmentDTOs(draft.id);
}

// Control characters, quotes and path/shell separators are stripped from uploaded file names.
const UNSAFE_FILENAME_CHARS = /[\p{Cc}"<>|:*?]/gu;

export function sanitiseFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  const cleaned = base.replace(UNSAFE_FILENAME_CHARS, "").trim().slice(0, 160);
  return cleaned || "upload";
}
