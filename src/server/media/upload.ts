import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { optionalOrganizationId } from "@/server/tenancy/context";
import { guardTenant } from "@/server/tenancy/scope";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { roleHasPermission } from "@/lib/auth/permissions";
import { ingestMedia, sniffMime, SUPPORTED_IMAGE_MIMES } from "./ingest";
import { enqueueMediaProcessing } from "./jobs";
import { MEDIA_KINDS, RIGHTS_STATUSES, STORY_MEDIA_ROLES } from "./constants";
import { attachToStory, type MediaActor } from "./rights";
import { mediaUrls } from "./urls";

const log = createLogger("media:upload");

export const uploadFileMetaSchema = z.object({
  caption: z.string().trim().max(400).nullable().optional(),
  altText: z.string().trim().max(400).nullable().optional(),
  photographer: z.string().trim().max(120).nullable().optional(),
  credit: z.string().trim().max(160).nullable().optional(),
  rightsStatus: z.enum(RIGHTS_STATUSES).optional(),
  rightsNote: z.string().trim().max(1000).nullable().optional(),
  kind: z.enum(MEDIA_KINDS).optional(),
});
export type UploadFileMeta = z.input<typeof uploadFileMetaSchema>;

export type UploadFile = UploadFileMeta & {
  buffer: Buffer;
  fileName: string;
  mimeType?: string | null;
};

export type UploadMediaInput = {
  files: UploadFile[];
  /** The edition the files belong to; none means the workspace's library at large. */
  editionId: string | null;
  /** The newsletter whose library they go in, when uploaded there rather than into an edition. */
  publicationId?: string | null;
  storyId?: string | null;
  role?: string | null;
  actor: MediaActor;
  /** Skip the background job (tests, scripts). */
  skipProcessing?: boolean;
};

export type UploadedAsset = {
  id: string;
  fileName: string;
  thumbUrl: string | null;
  webUrl: string | null;
  width: number | null;
  height: number | null;
  qualityScore: number | null;
  qualityFlags: string[];
  duplicateOfId: string | null;
  rightsStatus: "GREEN" | "YELLOW" | "RED";
  kind: string;
  storyId: string | null;
};

export class UploadError extends AppError {
  constructor(message: string, status: 400 | 413 | 415, code = "UPLOAD") {
    super(message, code, status);
    this.name = "UploadError";
  }
}

export function maxUploadBytes() {
  return Math.round(env.UPLOAD_MAX_FILE_MB * 1024 * 1024);
}

/**
 * Validates then ingests a batch of images uploaded by a newsroom user. Validation of every file
 * (size, sniffed MIME) happens before the first ingestion so a bad file never leaves a half batch.
 */
export async function uploadMedia(input: UploadMediaInput): Promise<UploadedAsset[]> {
  if (!roleHasPermission(input.actor.role, "media:manage"))
    throw new ForbiddenError("Missing permission: media:manage");
  if (!input.files.length) throw new UploadError("No file received", 400, "NO_FILE");
  if (input.files.length > env.UPLOAD_MAX_FILES_PER_SUBMISSION)
    throw new UploadError(
      `Too many files (max ${env.UPLOAD_MAX_FILES_PER_SUBMISSION} per upload)`,
      400,
      "TOO_MANY_FILES",
    );
  if (input.editionId && !z.string().uuid().safeParse(input.editionId).success)
    throw new UploadError("editionId must be a UUID", 400, "BAD_EDITION");
  // Another workspace's edition or newsletter is "not found": files never land in somebody else's library.
  const edition = input.editionId
    ? await guardTenant(
        await db.query.editions.findFirst({
          where: eq(s.editions.id, input.editionId),
          columns: { id: true, status: true, organizationId: true },
        }),
        "Edition",
      )
    : null;
  if (input.editionId && !edition) throw new NotFoundError("Edition");
  if (input.publicationId && !z.string().uuid().safeParse(input.publicationId).success)
    throw new UploadError("publicationId must be a UUID", 400, "BAD_PUBLICATION");
  const publication = input.publicationId
    ? await guardTenant(await db.query.publications.findFirst({ where: eq(s.publications.id, input.publicationId), columns: { id: true, organizationId: true } }), "Newsletter")
    : null;
  if (input.publicationId && !publication) throw new NotFoundError("Newsletter");
  if (!edition && !(await optionalOrganizationId())) throw new UploadError("Choose an edition or open a workspace first", 400, "BAD_EDITION");
  let story: { id: string; editionId: string } | null = null;
  if (input.storyId) {
    if (!z.string().uuid().safeParse(input.storyId).success)
      throw new UploadError("storyId must be a UUID", 400, "BAD_STORY");
    story =
      (await db.query.stories.findFirst({
        where: eq(s.stories.id, input.storyId),
        columns: { id: true, editionId: true },
      })) ?? null;
    if (!story) throw new NotFoundError("Story");
    if (!edition || story.editionId !== edition.id)
      throw new ValidationError("The story belongs to another edition");
  }
  const role =
    input.role && (STORY_MEDIA_ROLES as readonly string[]).includes(input.role)
      ? (input.role as (typeof STORY_MEDIA_ROLES)[number])
      : "gallery";

  const limit = maxUploadBytes();
  const prepared: {
    file: UploadFile;
    mimeType: string;
    meta: z.infer<typeof uploadFileMetaSchema>;
  }[] = [];
  for (const file of input.files) {
    if (!file.buffer.byteLength)
      throw new UploadError(`${file.fileName}: empty file`, 400, "EMPTY_FILE");
    if (file.buffer.byteLength > limit)
      throw new UploadError(
        `${file.fileName}: larger than ${env.UPLOAD_MAX_FILE_MB} MB`,
        413,
        "FILE_TOO_LARGE",
      );
    const mimeType = await sniffMime(file.buffer, file.mimeType ?? undefined);
    if (!(SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mimeType)) {
      throw new UploadError(
        `${file.fileName}: unsupported image type (${mimeType}). Use JPEG, PNG, WebP, GIF, TIFF or AVIF.`,
        415,
        "UNSUPPORTED_TYPE",
      );
    }
    const meta = uploadFileMetaSchema.safeParse(file);
    if (!meta.success)
      throw new ValidationError(`${file.fileName}: invalid metadata`, {
        meta: meta.error.issues.map((i) => i.message),
      });
    prepared.push({ file, mimeType, meta: meta.data });
  }

  const out: UploadedAsset[] = [];
  for (const { file, mimeType, meta } of prepared) {
    const { asset } = await ingestMedia({
      buffer: file.buffer,
      fileName: file.fileName.replace(/[\\/]/g, "_").slice(0, 200) || "upload",
      mimeType,
      editionId: edition?.id ?? null,
      publicationId: publication?.id ?? null,
      userId: input.actor.id,
      caption: meta.caption || null,
      altText: meta.altText || null,
      photographer: meta.photographer || null,
      credit: meta.credit || null,
      rightsStatus: meta.rightsStatus,
      rightsNote: meta.rightsNote || null,
      kind: meta.kind,
    });
    await audit({
      action: "media.upload",
      userId: input.actor.id,
      entityType: "MEDIA",
      entityId: asset.id,
      editionId: edition?.id ?? null,
      metadata: {
        fileName: asset.fileName,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        mimeType,
      },
    });
    if (story) {
      try {
        await attachToStory(asset.id, story.id, role, input.actor);
      } catch (err) {
        log.warn("could not attach uploaded asset to story", {
          assetId: asset.id,
          storyId: story.id,
          err,
        });
      }
    }
    if (!input.skipProcessing) {
      await enqueueMediaProcessing(asset.id, { editionId: edition?.id ?? null, userId: input.actor.id });
    }
    out.push({
      id: asset.id,
      fileName: asset.fileName,
      thumbUrl: null,
      webUrl: null,
      width: asset.width,
      height: asset.height,
      qualityScore: asset.qualityScore,
      qualityFlags: asset.qualityFlags,
      duplicateOfId: asset.duplicateOfId,
      rightsStatus: asset.rightsStatus,
      kind: asset.kind,
      storyId: story?.id ?? null,
    });
  }
  const ids = out.map((a) => a.id);
  const [thumbs, webs] = await Promise.all([mediaUrls(ids, "THUMBNAIL"), mediaUrls(ids, "WEB")]);
  for (const a of out) {
    a.thumbUrl = thumbs[a.id] ?? null;
    a.webUrl = webs[a.id] ?? null;
  }
  log.info("uploaded", {
    count: out.length,
    editionId: edition?.id ?? null,
    storyId: story?.id ?? null,
    userId: input.actor.id,
  });
  return out;
}

/** Parses the multipart body of POST /api/uploads into `UploadMediaInput` files (without the actor). */
export async function parseUploadForm(
  form: FormData,
): Promise<{
  files: UploadFile[];
  editionId: string | null;
  publicationId: string | null;
  storyId: string | null;
  role: string | null;
}> {
  const entries = form
    .getAll("file")
    .filter(
      (f): f is File =>
        typeof f === "object" && f !== null && typeof (f as File).arrayBuffer === "function",
    );
  const text = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" ? v : null;
  };
  let perFile: UploadFileMeta[] = [];
  const metaRaw = text("meta");
  if (metaRaw) {
    try {
      const parsed = JSON.parse(metaRaw) as unknown;
      if (Array.isArray(parsed)) perFile = parsed as UploadFileMeta[];
    } catch {
      throw new UploadError("meta must be a JSON array", 400, "BAD_META");
    }
  }
  const shared: UploadFileMeta = {
    caption: text("caption") ?? undefined,
    altText: text("altText") ?? undefined,
    photographer: text("photographer") ?? undefined,
    credit: text("credit") ?? undefined,
    rightsStatus: (text("rightsStatus") as UploadFileMeta["rightsStatus"]) ?? undefined,
    rightsNote: text("rightsNote") ?? undefined,
    kind: (text("kind") as UploadFileMeta["kind"]) ?? undefined,
  };
  const files: UploadFile[] = [];
  for (const [i, f] of entries.entries()) {
    const override = perFile[i] ?? {};
    const merged: UploadFileMeta = { ...shared };
    for (const key of Object.keys(override) as (keyof UploadFileMeta)[]) {
      const v = override[key];
      if (v !== undefined && v !== null && v !== "") (merged as Record<string, unknown>)[key] = v;
    }
    files.push({
      ...merged,
      buffer: Buffer.from(await f.arrayBuffer()),
      fileName: f.name || `upload-${i + 1}`,
      mimeType: f.type || null,
    });
  }
  return {
    files,
    editionId: text("editionId") || null,
    publicationId: text("publicationId") || null,
    storyId: text("storyId") || null,
    role: text("role") || null,
  };
}
