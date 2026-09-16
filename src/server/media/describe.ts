import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { runAiTask } from "@/server/ai/run";
import { createLogger } from "@/server/logger";
import { AppError, NotFoundError } from "@/lib/action-result";
import { MEDIA_KINDS } from "./constants";

const log = createLogger("media:describe");

export const imageDescriptionSchema = z.object({
  description: z.string().trim().min(1).max(600),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  kind: z.enum(MEDIA_KINDS),
});
export type ImageDescription = z.infer<typeof imageDescriptionSchema>;

export class MediaDescribeError extends AppError {
  constructor(message: string) {
    super(message, "AI_DESCRIBE_FAILED", 502);
    this.name = "MediaDescribeError";
  }
}

export type DescribeMediaResult = ImageDescription & {
  aiJobId: string;
  model: string;
  cached: boolean;
  /** Which columns were written on the asset. */
  applied: ("aiDescription" | "aiTags" | "altText" | "kind")[];
};

function normaliseTags(tags: string[]) {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.toLowerCase().replace(/^#/, "").replace(/\s+/g, " ").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}

/** Story titles + submission title + edition label: enough context for a useful description, no people. */
async function contextFor(asset: typeof s.mediaAssets.$inferSelect) {
  const [stories, submission, edition] = await Promise.all([
    db
      .select({ title: s.stories.title })
      .from(s.storyMedia)
      .innerJoin(s.stories, eq(s.stories.id, s.storyMedia.storyId))
      .where(eq(s.storyMedia.mediaAssetId, asset.id)),
    asset.submissionId
      ? db.query.submissions.findFirst({
          where: eq(s.submissions.id, asset.submissionId),
          columns: { title: true, storyType: true },
        })
      : null,
    asset.editionId
      ? db.query.editions.findFirst({
          where: eq(s.editions.id, asset.editionId),
          columns: { label: true },
        })
      : null,
  ]);
  const parts: string[] = [];
  if (stories.length) parts.push(`Stories: ${stories.map((x) => x.title).join("; ")}`);
  if (submission)
    parts.push(
      `Submission: ${submission.title} (${submission.storyType.toLowerCase().replace(/_/g, " ")})`,
    );
  if (edition) parts.push(`Edition: ${edition.label}`);
  parts.push(`Current kind: ${asset.kind}`);
  return parts.join(" · ");
}

/**
 * Describes one asset with the "image_describer" prompt and stores the result: description, tags,
 * alt text (only when empty) and kind (only when it was never set explicitly). The prompt forbids
 * naming people; nothing here adds names either. Throws `MediaDescribeError` when the provider
 * cannot answer, so callers can degrade gracefully.
 */
export async function describeMedia(
  assetId: string,
  options: { force?: boolean } = {},
): Promise<DescribeMediaResult> {
  const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, assetId) });
  if (!asset) throw new NotFoundError("Media asset");
  const context = await contextFor(asset);
  let result: Awaited<ReturnType<typeof runAiTask<ImageDescription>>>;
  try {
    result = await runAiTask({
      service: "image_describer",
      promptKey: "image_describer",
      schema: imageDescriptionSchema,
      schemaName: "ImageDescription",
      input: {
        fileName: asset.fileName,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        caption: asset.caption ?? "",
        context,
        kinds: [...MEDIA_KINDS],
      },
      editionId: asset.editionId,
      entityType: "MEDIA",
      entityId: asset.id,
      cacheable: !options.force,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("describe failed", { assetId, err });
    throw new MediaDescribeError(`AI description unavailable: ${message}`);
  }
  const output = result.output;
  const tags = normaliseTags(output.tags);
  const values: Partial<typeof s.mediaAssets.$inferInsert> = {
    aiDescription: output.description,
    aiTags: tags,
  };
  const applied: DescribeMediaResult["applied"] = ["aiDescription", "aiTags"];
  if (!asset.altText?.trim()) {
    values.altText =
      output.description.length > 250
        ? `${output.description.slice(0, 249).trimEnd()}…`
        : output.description;
    applied.push("altText");
  }
  const kindSetByUser = !!(asset.metadata as { kindSetByUser?: boolean }).kindSetByUser;
  if (!kindSetByUser && asset.kind === "photo" && output.kind !== asset.kind) {
    values.kind = output.kind;
    applied.push("kind");
  }
  values.metadata = {
    ...asset.metadata,
    describedAt: new Date().toISOString(),
    describeModel: result.model,
    describeJobId: result.aiJobId,
  };
  await db.update(s.mediaAssets).set(values).where(eq(s.mediaAssets.id, assetId));
  return {
    ...output,
    tags,
    aiJobId: result.aiJobId,
    model: result.model,
    cached: result.cached,
    applied,
  };
}

export type DescribeProgress = {
  done: number;
  total: number;
  assetId: string;
  status: "described" | "failed";
  error?: string;
};

export type DescribeEditionResult = {
  total: number;
  described: number;
  failed: number;
  skipped: number;
  errors: { assetId: string; error: string }[];
};

/**
 * Describes every (non-archived) asset of an edition — by default only those without a description.
 * Failures never stop the batch; the caller receives a progress callback per asset.
 */
export async function describeEditionMedia(
  editionId: string,
  onProgress?: (progress: DescribeProgress) => void | Promise<void>,
  options: { force?: boolean; onlyMissing?: boolean; assetIds?: string[] } = {},
): Promise<DescribeEditionResult> {
  const onlyMissing = options.onlyMissing ?? !options.force;
  const rows = await db
    .select({ id: s.mediaAssets.id })
    .from(s.mediaAssets)
    .where(
      and(
        eq(s.mediaAssets.editionId, editionId),
        eq(s.mediaAssets.isArchived, false),
        onlyMissing ? isNull(s.mediaAssets.aiDescription) : undefined,
        options.assetIds?.length ? inArray(s.mediaAssets.id, options.assetIds) : undefined,
      ),
    );
  const total = rows.length;
  const result: DescribeEditionResult = { total, described: 0, failed: 0, skipped: 0, errors: [] };
  let done = 0;
  for (const row of rows) {
    try {
      await describeMedia(row.id, { force: options.force });
      result.described += 1;
      done += 1;
      await onProgress?.({ done, total, assetId: row.id, status: "described" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failed += 1;
      result.errors.push({ assetId: row.id, error });
      done += 1;
      await onProgress?.({ done, total, assetId: row.id, status: "failed", error });
    }
  }
  return result;
}
