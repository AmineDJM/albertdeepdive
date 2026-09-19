import { whyNotPictureKind } from "@/server/media/constants";
import { effectivePpi } from "../profiles";
import {
  ASSET_DECODES,
  IMAGE_CROP_LOSS,
  IMAGE_EFFECTIVE_PPI,
  IMAGE_ELIGIBLE,
  RIGHTS_CLEARED,
  RIGHTS_RESOLVED,
  STORAGE_DURABLE,
  STORAGE_OBJECT_PRESENT,
} from "../spec";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { assertThat, compare, merge, nothing, type CheckResult, type Finding, type MetricSpec } from "../types";
import type { Check, QcContext } from "../engine";

/**
 * The three questions about a picture that can be answered with arithmetic.
 *
 * Are the bytes there; is this the kind of thing that may carry a story; and is it big enough at
 * the size it is actually printed. None of them is a matter of taste, and all three have shipped
 * broken at least once: a logo as the lead picture of an interview, a thumbnail stretched across a
 * spread, and an entire library whose files had been taken by a container replacement.
 *
 * Measured on what is *attached* as well as on what is drawn. The page builder already refuses to
 * place a logo, so measuring only the drawn page would report a clean issue while a logo sat on a
 * story in the hero slot — and would report it clean again on the day that rule regressed, which is
 * exactly when somebody needs to be told. An attached defect is a real defect: the newsroom put it
 * there, and it is one edit away from being drawn.
 */

/** Roles that mean "this is the story's picture", as opposed to a mark filed beside it. */
const PICTURE_SLOTS = ["hero", "portrait", "cover"] as const as readonly string[];

/**
 * Every picture this issue depends on: the ones the document draws, and the ones its stories carry
 * in a slot meant for a photograph.
 */
async function candidates(ctx: QcContext): Promise<Map<string, { placed: boolean; page?: number; template?: string; role?: string }>> {
  const out = new Map<string, { placed: boolean; page?: number; template?: string; role?: string }>();
  for (const page of ctx.document.pages) {
    for (const mediaId of page.mediaIds ?? []) if (!out.has(mediaId)) out.set(mediaId, { placed: true, page: page.number, template: page.template });
  }
  for (const article of ctx.document.articles) {
    if (!article.heroMediaId || out.has(article.heroMediaId)) continue;
    const page = ctx.document.pages.find((each) => each.articleIds.includes(article.id));
    out.set(article.heroMediaId, { placed: true, page: page?.number, template: page?.template });
  }
  if (ctx.document.meta.cover.mediaId && !out.has(ctx.document.meta.cover.mediaId)) out.set(ctx.document.meta.cover.mediaId, { placed: true, page: 1, template: "COVER_A" });

  // …and what the stories carry, drawn or not.
  const stories = await db.select({ id: s.stories.id }).from(s.stories).where(eq(s.stories.editionId, ctx.editionId));
  if (stories.length) {
    const links = await db
      .select({ mediaAssetId: s.storyMedia.mediaAssetId, role: s.storyMedia.role })
      .from(s.storyMedia)
      .where(inArray(s.storyMedia.storyId, stories.map((story) => story.id)));
    for (const link of links) {
      const existing = out.get(link.mediaAssetId);
      if (existing?.placed) continue;
      // One picture can be attached to several stories in several roles — a logo filed as a logo on
      // one and dropped into the hero slot on another. The strongest role wins, or the second
      // attachment hides the defect in the first.
      if (existing && !PICTURE_SLOTS.includes(link.role)) continue;
      out.set(link.mediaAssetId, { placed: false, role: link.role });
    }
  }
  return out;
}

/** The library rows behind ids the document did not carry, because it refused to draw them. */
async function assetsById(ids: string[]) {
  if (!ids.length) return new Map<string, typeof s.mediaAssets.$inferSelect>();
  const rows = await db.select().from(s.mediaAssets).where(inArray(s.mediaAssets.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

/* ── Storage ──────────────────────────────────────────────────────────────────────────────── */

export const storageCheck: Check = {
  id: "storage",
  title: "Every file the issue references exists",
  async run(ctx: QcContext): Promise<CheckResult> {
    const results: CheckResult[] = [];

    // Which keys the issue actually depends on: the variant each output will reach for, and the
    // original behind it. A key nobody reads is not this run's problem.
    const keys = new Map<string, { mediaId: string; label: string; which: string }>();
    for (const media of ctx.document.media) {
      for (const [which, source] of [
        ["print", media.src.print],
        ["web", media.src.web],
        ["thumb", media.src.thumb],
      ] as const) {
        if (source?.key) keys.set(source.key, { mediaId: media.id, label: media.fileName ?? media.caption ?? media.id, which });
      }
    }

    // One listing beats N existence checks; fall back to per-key when a prefix cannot be listed.
    let present: Set<string> | null = null;
    try {
      present = new Set(await ctx.storage.list("media/"));
    } catch {
      present = null;
    }

    for (const [key, about] of keys) {
      const there = present ? present.has(key) : await ctx.storage.exists(key).catch(() => false);
      results.push(
        assertThat({
          spec: STORAGE_OBJECT_PRESENT,
          holds: there,
          location: { entityType: "media", entityId: about.mediaId, entityLabel: about.label, field: about.which },
          message: `The ${about.which} file for "${about.label}" is not in storage. A reader gets a broken picture; the export gets nothing to embed.`,
          expected: "the object exists",
          actual: "missing",
          evidence: { key },
        }),
      );
    }

    const { durableStatus } = await import("@/server/storage/audit");
    const durable = await durableStatus();
    results.push(
      assertThat({
        spec: STORAGE_DURABLE,
        holds: durable.durable,
        location: { entityType: "edition", entityId: ctx.editionId },
        message: durable.reason ?? "Durable storage is not object storage.",
        expected: "object storage",
        actual: durable.provider,
      }),
    );

    return merge(...results);
  },
};

/* ── Imagery ──────────────────────────────────────────────────────────────────────────────── */

/**
 * The millimetres an image occupies on the page, from the layout rather than from the file.
 *
 * This is the whole difficulty of resolution checking: a 4000px photograph is 400 PPI across a
 * half page and 130 across a spread, so the file's own dimensions say nothing. The placed width is
 * read from the page template's image box where the layout declares one, and otherwise from the
 * page's usable width, which is the honest upper bound — a picture never occupies more than that.
 */
function placedWidthMm(ctx: QcContext, template: string): number {
  const trim = ctx.profile.trimMm ?? { width: 210, height: 297 };
  const margin = ctx.profile.safeMarginMm ?? 10;
  const usable = trim.width - margin * 2;
  // Templates whose picture spans the full measure, versus those that give it a column.
  const fullBleed = /COVER|PHOTO_STORY|BDD_VISUAL|ARTICLE_HERO|FULL/i.test(template);
  return fullBleed ? trim.width : usable * 0.5;
}

export const imageryCheck: Check = {
  id: "imagery",
  title: "Pictures are eligible, undistorted and big enough where they land",
  async run(ctx: QcContext): Promise<CheckResult> {
    const results: CheckResult[] = [];
    const inDocument = new Map(ctx.document.media.map((media) => [media.id, media]));
    const minimum = ctx.profile.minimumPpi;

    const where_ = await candidates(ctx);
    const extra = await assetsById([...where_.keys()].filter((id) => !inDocument.has(id)));

    for (const [mediaId, where] of where_) {
      const fromDocument = inDocument.get(mediaId);
      const row = extra.get(mediaId);
      const media = fromDocument ?? (row ? { ...row, aspectRatio: row.width && row.height ? row.width / row.height : null, src: { print: null, web: null, thumb: null } } : null);
      if (!media) continue;
      const label = media.fileName ?? media.caption ?? mediaId;
      const location = { entityType: "media" as const, entityId: mediaId, entityLabel: label, page: where.page };

      // Eligibility: the page builder's rule minus its rights clause, measured here so a
      // hand-placed logo is caught as well as a chosen one. Rights are deliberately left out — the
      // rights check below measures them under their own metric, and if they counted here too the
      // same refused photograph would be reported twice under two rules with opposite repair
      // policies, the weaker of which would quietly unlink it and turn the block into a pass.
      const refusal = whyNotPictureKind(media);
      const pictureSlot = where.placed || PICTURE_SLOTS.includes(where.role ?? "");
      if (pictureSlot) {
        results.push(
          assertThat({
            spec: IMAGE_ELIGIBLE,
            holds: refusal === null,
            location,
            message: where.placed
              ? `"${label}" is on page ${where.page} and is not something that may carry a story: ${refusal}`
              : `"${label}" is attached to a story in the ${where.role} slot and is not something that may carry a story: ${refusal}`,
            expected: "a photograph, chart, diagram or screenshot",
            actual: refusal ?? "eligible",
            evidence: { kind: media.kind, rights: media.rightsStatus, placed: where.placed, role: where.role },
          }),
        );
      }

      if (!where.placed) continue;

      // Decode: a file that will not decode renders as a broken box whatever else is true of it.
      results.push(
        assertThat({
          spec: ASSET_DECODES,
          holds: Boolean(media.width && media.height && media.width > 0 && media.height > 0),
          location,
          message: `"${label}" has no usable dimensions, so nothing can lay it out.`,
          expected: "width and height above zero",
          actual: `${media.width ?? 0}×${media.height ?? 0}`,
        }),
      );

      if (minimum && media.width) {
        const sourcePixels = media.src.print?.width ?? media.width;
        const mm = placedWidthMm(ctx, where.template ?? "");
        const ppi = effectivePpi(sourcePixels, mm);
        const spec: MetricSpec = {
          ...IMAGE_EFFECTIVE_PPI,
          failureThreshold: minimum,
          warningThreshold: ctx.profile.warnPpi,
        };
        results.push(
          compare({
            spec,
            actual: ppi,
            direction: "at-least",
            location,
            message: `"${label}" is ${Math.round(ppi)} PPI at the ${Math.round(mm)}mm it occupies on page ${where.page}. ${ctx.profile.title} needs ${minimum}.`,
            expectedText: `≥ ${minimum} ppi`,
            evidence: { sourcePixels, placedMm: Math.round(mm), profile: ctx.profile.id },
          }),
        );
      }

      // The crop: how much of the picture the page keeps. Nothing is ever stretched — every figure
      // in the stylesheet is object-fit: cover or contain — so the question is what is cut off.
      if (media.aspectRatio && where.template) {
        const container = containerAspect(ctx, where.template);
        if (container) {
          const lost = 1 - Math.min(container, media.aspectRatio) / Math.max(container, media.aspectRatio);
          results.push(
            compare({
              spec: IMAGE_CROP_LOSS,
              actual: lost,
              location,
              message: `"${label}" is ${media.aspectRatio.toFixed(2)}:1 in a ${container.toFixed(2)}:1 box on page ${where.page}, so ${Math.round(lost * 100)}% of the frame is cropped away.`,
              evidence: { sourceAspect: Number(media.aspectRatio.toFixed(3)), containerAspect: Number(container.toFixed(3)), lostFraction: Number(lost.toFixed(3)) },
            }),
          );
        }
      }
    }

    return results.length ? merge(...results) : nothing();
  },
};

/**
 * The shape of the box a template gives a picture, for the templates that crop.
 *
 * Only the ones whose figures are `object-fit: cover`. A template that uses `contain` fits the
 * whole picture inside its box and throws nothing away, so asking how much it crops has no answer —
 * and answering anyway would report a loss on a picture that is entirely visible.
 */
function containerAspect(ctx: QcContext, template: string): number | null {
  const trim = ctx.profile.trimMm;
  if (!trim) return null;
  if (/BDD_VISUAL|VISUAL_GRID|SOCIAL/i.test(template)) return null;
  if (/COVER/i.test(template)) return trim.width / trim.height;
  if (/PHOTO_STORY/i.test(template)) return 3 / 2;
  if (/ARTICLE_HERO/i.test(template)) return 16 / 9;
  return null;
}

/* ── Rights ───────────────────────────────────────────────────────────────────────────────── */

export const rightsCheck: Check = {
  id: "rights",
  title: "Nothing goes out whose rights are refused or unresolved",
  async run(ctx: QcContext): Promise<CheckResult> {
    const results: CheckResult[] = [];
    const where_ = await candidates(ctx);
    const inDocument = new Map(ctx.document.media.map((media) => [media.id, media]));
    const extra = await assetsById([...where_.keys()].filter((id) => !inDocument.has(id)));

    let unresolved = 0;
    for (const [mediaId, where] of where_) {
      const media = inDocument.get(mediaId) ?? extra.get(mediaId);
      if (!media) continue;
      const label = media.fileName ?? media.caption ?? mediaId;
      const location = { entityType: "media" as const, entityId: mediaId, entityLabel: label, page: where.page };
      results.push(
        assertThat({
          spec: RIGHTS_CLEARED,
          holds: media.rightsStatus !== "RED",
          location,
          message: where.placed
            ? `"${label}" is placed in the issue and its rights are refused. It may not be published anywhere.`
            : `"${label}" is attached to a story in this issue and its rights are refused. It may not be published anywhere.`,
          expected: "GREEN or YELLOW",
          actual: media.rightsStatus,
          evidence: { placed: where.placed, role: where.role },
        }),
      );
      if (media.rightsStatus === "YELLOW" && where.placed) unresolved += 1;
    }

    results.push(
      compare({
        spec: RIGHTS_RESOLVED,
        actual: unresolved,
        location: { entityType: "edition", entityId: ctx.editionId },
        message: `${unresolved} placed picture(s) still have rights nobody has cleared.`,
      }),
    );
    return merge(...results);
  },
};

/** Every finding this file can produce, for the catalogue in the console. */
export const ASSET_METRIC_IDS = [
  STORAGE_OBJECT_PRESENT.id,
  STORAGE_DURABLE.id,
  ASSET_DECODES.id,
  IMAGE_ELIGIBLE.id,
  IMAGE_EFFECTIVE_PPI.id,
  IMAGE_CROP_LOSS.id,
  RIGHTS_CLEARED.id,
  RIGHTS_RESOLVED.id,
] as const;

export type { Finding };
