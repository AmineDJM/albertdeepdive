import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { canIllustrate } from "@/server/media/constants";
import { audit } from "@/server/audit";
import { getStorage, type StorageAdapter } from "@/server/storage";
import { createLogger } from "@/server/logger";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { guardTenant } from "@/server/tenancy/scope";
import { activeBrand } from "@/server/brand/service";
import { compileBrandSystem } from "@/lib/brand/system";
import { composeSpec } from "@/lib/creative/compose";
import { inspect, repair, verdict, type Finding } from "@/lib/creative/qa";
import { parseBrief, type CreativeBrief } from "@/lib/creative/brief";
import { clampFrames, FORMATS, MODES, type CreativeFormat, type CreativeMode } from "@/lib/creative/formats";

const log = createLogger("creative");
import { resolveEntitlements } from "@/server/billing/entitlements";

/**
 * Creative packs, from a request to a rendered set of files.
 *
 * The lifecycle is deliberately in four steps rather than one, because they fail differently:
 *
 *   create   — a row, a format, a mode. Cheap, always succeeds.
 *   direct   — a model writes the brief. Costs money, can return nonsense, retried with the
 *              validator's complaints handed back.
 *   compose  — arithmetic. Cannot fail on a valid brief, costs nothing, and is re-run whenever the
 *              brand changes.
 *   render   — files. Slow, and for video slow enough to need a worker.
 *
 * Keeping them apart means editing a headline re-composes without re-asking the model, and changing
 * the brand re-composes without re-writing the copy.
 */

export type CreativePack = typeof s.creativePacks.$inferSelect;
export type CreativeAsset = typeof s.creativeAssets.$inferSelect;

export async function listPacks(organizationId: string, filters: { editionId?: string; status?: CreativePack["status"] } = {}) {
  return db.query.creativePacks.findMany({
    where: and(
      eq(s.creativePacks.organizationId, organizationId),
      filters.editionId ? eq(s.creativePacks.editionId, filters.editionId) : undefined,
      filters.status ? eq(s.creativePacks.status, filters.status) : undefined,
    ),
    orderBy: [desc(s.creativePacks.createdAt)],
    limit: 60,
  });
}

export async function getPack(packId: string): Promise<CreativePack & { assets: CreativeAsset[] }> {
  const pack = await db.query.creativePacks.findFirst({ where: eq(s.creativePacks.id, packId) });
  if (!pack) throw new NotFoundError("Creative pack");
  await guardTenant(pack, "Creative pack");
  const assets = await db.query.creativeAssets.findMany({
    where: eq(s.creativeAssets.packId, packId),
    orderBy: [s.creativeAssets.kind, s.creativeAssets.index],
  });
  return { ...pack, assets };
}

/**
 * Whether this workspace may make this.
 *
 * Two separate gates. `socialPack` is whether Creative Studio exists for them at all; the mode gate
 * is whether they may ask a provider to generate imagery, which costs money per use and is the only
 * part that puts something on screen that was never photographed.
 */
export async function assertCanCreate(organizationId: string, mode: CreativeMode) {
  const plan = await resolveEntitlements(organizationId);
  const entitlements = plan.entitlements as Record<string, unknown>;
  if (entitlements.socialPack === false) {
    throw new ForbiddenError("Creative Studio is not included in this plan.");
  }
  if (MODES[mode].usesGeneratedImagery && entitlements.videoGeneration === false && entitlements.cinematicMode !== true) {
    throw new ForbiddenError("Cinematic mode needs a plan that includes generated media.");
  }
}

export async function createPack(input: {
  organizationId: string;
  name: string;
  format: CreativeFormat;
  mode?: CreativeMode;
  editionId?: string | null;
  storyId?: string | null;
  publicationId?: string | null;
  actorId?: string | null;
}): Promise<CreativePack> {
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Give it a name", { name: ["At least two characters"] });
  if (!FORMATS[input.format]) throw new ValidationError("Unknown format");
  const mode = input.mode ?? "STUDIO";
  await assertCanCreate(input.organizationId, mode);

  const [pack] = await db
    .insert(s.creativePacks)
    .values({
      organizationId: input.organizationId,
      name,
      format: input.format,
      mode,
      editionId: input.editionId ?? null,
      storyId: input.storyId ?? null,
      publicationId: input.publicationId ?? null,
      createdById: input.actorId ?? null,
    })
    .returning();

  await audit({
    action: "creative.pack.create",
    entityType: "SETTING",
    entityId: pack.id,
    organizationId: input.organizationId,
    userId: input.actorId ?? null,
    metadata: { format: input.format, mode },
  });
  return pack;
}

/**
 * Store a brief and resolve it into a spec.
 *
 * Validation is here rather than in the caller because it has to hold for the model, for a person
 * editing a headline, and for the seeder. A brief that fails structural checks is rejected with the
 * sentences the model needs to fix it, not with a stack trace.
 */
export async function setBrief(input: { packId: string; brief: unknown; actorId?: string | null }): Promise<CreativePack> {
  const pack = await getPack(input.packId);
  const parsed = parseBrief(input.brief);
  if (!parsed.ok) throw new ValidationError("That brief cannot be rendered", { brief: parsed.problems });

  // The format and mode belong to the pack, not to whatever the brief claims: a model that decides
  // to make a Story when it was asked for a carousel is a model being overruled, not a new pack.
  const brief: CreativeBrief = {
    ...parsed.brief,
    format: pack.format,
    mode: pack.mode,
    frames: parsed.brief.frames.slice(0, clampFrames(pack.format, parsed.brief.frames.length)),
  };

  const record = await activeBrand(pack.organizationId);
  if (!record) throw new NotFoundError("Brand");
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, pack.organizationId), columns: { name: true } });
  const tokens = compileBrandSystem(record.system);
  const compose = (from: CreativeBrief) => composeSpec(from, tokens, { brandVersion: record.id, system: pack.designSystem, organizationName: organization?.name ?? "" });

  /**
   * Compose, inspect, repair, compose again — at most twice.
   *
   * One repair pass, not a loop. Every repair is a smaller ask (quieter, shorter, fewer items), so a
   * second round has almost nothing left to take away and a third would start removing the content
   * itself. If two passes cannot produce a clean spec the pack says so and a person decides, which
   * is the right outcome for a brief that genuinely will not fit.
   */
  let finalBrief = brief;
  let spec = compose(brief);
  let findings = inspect(spec, brief);
  const repairs: string[] = [];

  if (findings.some((finding) => finding.severity === "defect" && finding.repairable)) {
    const repaired = repair(brief, findings);
    if (repaired.repairs.length) {
      finalBrief = repaired.brief;
      spec = compose(finalBrief);
      findings = inspect(spec, finalBrief);
      repairs.push(...repaired.repairs.map((entry) => `frame ${entry.frame + 1}: ${entry.change}`));
    }
  }

  const defects = findings.filter((finding) => finding.severity === "defect");

  const [updated] = await db
    .update(s.creativePacks)
    .set({
      brief: finalBrief,
      spec,
      brandSystemId: record.id,
      fingerprint: spec.fingerprint,
      status: defects.length ? "FAILED" : "COMPOSING",
      error: defects.length ? defects.map((defect) => (defect.frame === null ? defect.message : `frame ${defect.frame + 1}: ${defect.message}`)).join("; ").slice(0, 500) : null,
      updatedAt: new Date(),
    })
    .where(eq(s.creativePacks.id, pack.id))
    .returning();

  await syncAssetRows(updated);
  await audit({
    action: "creative.pack.brief",
    entityType: "SETTING",
    entityId: pack.id,
    organizationId: pack.organizationId,
    userId: input.actorId ?? null,
    metadata: { frames: finalBrief.frames.length, fingerprint: spec.fingerprint, defects: defects.length, repairs },
  });
  return updated;
}

/**
 * Re-resolve an existing brief against the current brand.
 *
 * The reason the two layers are separate. A customer changes their accent colour and every pack they
 * have can be brought up to date without a model call and without anybody rewriting a headline.
 */
export async function recompose(packId: string, actorId?: string | null): Promise<CreativePack> {
  const pack = await getPack(packId);
  if (!pack.brief) throw new ValidationError("This pack has no brief yet.");
  return setBrief({ packId, brief: pack.brief, actorId });
}

/**
 * Make the asset rows match the spec.
 *
 * Everything derived from the spec goes back to PENDING — every frame, and the cover and video that
 * are built from them. All of it, not only what changed: a recompose changes the spec, the spec is
 * what every file was drawn from, and working out which frames happen to be byte-identical costs
 * more than redrawing them.
 *
 * The cover and the video matter here as much as the frames. Leaving them READY while the frames
 * they are made of go PENDING left the studio showing last week's video above this week's slides,
 * labelled ready, for as long as the render took.
 *
 * Frames removed by an edit have their rows deleted and their files forgotten, which is what the
 * unique index on (pack, kind, index) is for.
 */
async function syncAssetRows(pack: CreativePack) {
  if (!pack.spec) return;
  const wanted = pack.spec.frames.length;
  const existing = await db.query.creativeAssets.findMany({ where: and(eq(s.creativeAssets.packId, pack.id), eq(s.creativeAssets.kind, "FRAME")) });

  const toDelete = existing.filter((asset) => asset.index >= wanted);
  if (toDelete.length) {
    await db.delete(s.creativeAssets).where(
      and(eq(s.creativeAssets.packId, pack.id), eq(s.creativeAssets.kind, "FRAME"), gte(s.creativeAssets.index, wanted)),
    );
    // A re-direct that produces fewer slides leaves the surplus files behind otherwise: the rows go,
    // and `frame-06.jpg` sits in the bucket with nothing left pointing at it.
    await forget(toDelete.map((asset) => asset.storageKey).filter((key): key is string => Boolean(key)));
  }

  // The cover and the video are derived from the frames, so a changed spec invalidates them too.
  await db
    .update(s.creativeAssets)
    .set({ status: "PENDING", error: null, updatedAt: new Date() })
    .where(and(eq(s.creativeAssets.packId, pack.id), inArray(s.creativeAssets.kind, ["COVER", "VIDEO"])));

  for (const frame of pack.spec.frames) {
    const alt = frame.alt;
    const mediaId = frame.image?.mediaId ?? null;
    await db
      .insert(s.creativeAssets)
      .values({
        organizationId: pack.organizationId,
        packId: pack.id,
        kind: "FRAME",
        index: frame.index,
        status: "PENDING",
        width: frame.width,
        height: frame.height,
        mediaId,
        generated: Boolean(frame.image?.generate),
        alt,
      })
      .onConflictDoUpdate({
        target: [s.creativeAssets.packId, s.creativeAssets.kind, s.creativeAssets.index],
        set: { status: "PENDING", width: frame.width, height: frame.height, mediaId, generated: Boolean(frame.image?.generate), alt, error: null, updatedAt: new Date() },
      });
  }
}

/** A rendered file has arrived. Called by the worker, never by a request. */
export async function attachRendered(input: {
  packId: string;
  index: number;
  kind?: CreativeAsset["kind"];
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  durationSeconds?: number;
}) {
  await db
    .update(s.creativeAssets)
    .set({
      status: "READY",
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      durationSeconds: input.durationSeconds ?? null,
      error: null,
      updatedAt: new Date(),
    })
    .where(and(eq(s.creativeAssets.packId, input.packId), eq(s.creativeAssets.kind, input.kind ?? "FRAME"), eq(s.creativeAssets.index, input.index)));

  await settlePackStatus(input.packId);
}

export async function failAsset(packId: string, index: number, error: string, kind: CreativeAsset["kind"] = "FRAME") {
  await db
    .update(s.creativeAssets)
    .set({ status: "FAILED", error: error.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(s.creativeAssets.packId, packId), eq(s.creativeAssets.kind, kind), eq(s.creativeAssets.index, index)));
  await settlePackStatus(packId);
}

/**
 * A pack is only ready when every one of its assets is.
 *
 * Derived from the assets rather than tracked separately: a counter that has to be decremented in
 * the right places is a counter that eventually disagrees with the rows it counts.
 */
async function settlePackStatus(packId: string) {
  const assets = await db.query.creativeAssets.findMany({ where: eq(s.creativeAssets.packId, packId), columns: { status: true, error: true } });
  if (!assets.length) return;
  const failed = assets.filter((asset) => asset.status === "FAILED");
  const pending = assets.filter((asset) => asset.status === "PENDING" || asset.status === "RENDERING");

  const status: CreativePack["status"] = failed.length ? "FAILED" : pending.length ? "RENDERING" : "READY";
  await db
    .update(s.creativePacks)
    .set({ status, error: failed.length ? (failed[0].error ?? "A frame failed to render") : null, updatedAt: new Date() })
    .where(eq(s.creativePacks.id, packId));
}

/* ── Cost ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * Record what something cost, and keep the pack's total in step.
 *
 * Every provider call goes through here, including the free ones: a ledger with gaps cannot answer
 * "what did this carousel cost", and "0.00" from our own renderer is a real and useful answer.
 */
export async function recordCost(input: {
  organizationId: string;
  packId?: string | null;
  assetId?: string | null;
  provider: string;
  operation: string;
  model?: string | null;
  units?: number;
  unit?: string;
  costCents: number;
  credits?: number;
}) {
  await db.insert(s.creativeCosts).values({
    organizationId: input.organizationId,
    packId: input.packId ?? null,
    assetId: input.assetId ?? null,
    provider: input.provider,
    operation: input.operation,
    model: input.model ?? null,
    units: input.units ?? 1,
    unit: input.unit ?? "call",
    costCents: String(input.costCents),
    credits: input.credits ?? 0,
  });

  if (input.packId) {
    await db
      .update(s.creativePacks)
      .set({ costCents: sql`${s.creativePacks.costCents} + ${String(input.costCents)}`, updatedAt: new Date() })
      .where(eq(s.creativePacks.id, input.packId));
  }
}

/** Credits used this calendar month, which is what an allowance is measured against. */
export async function creditsUsedThisMonth(organizationId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ credits: sql<number>`coalesce(sum(${s.creativeCosts.credits}), 0)` })
    .from(s.creativeCosts)
    .where(and(eq(s.creativeCosts.organizationId, organizationId), gte(s.creativeCosts.createdAt, monthStart)));
  return Number(row.credits);
}

/**
 * Whether there is allowance left for work that costs credits.
 *
 * `null` means unlimited, which is deliberately different from a large number: an enterprise plan
 * should not silently acquire a cap the day somebody picks a round figure for it.
 */
/**
 * Whether `needed` more credits would fit inside this month's allowance.
 *
 * The same arithmetic as `assertCredits` without the throw, for the callers that would rather do
 * something cheaper than fail. Both read the plan and the ledger rather than a counter, so a refund,
 * a plan change or a correction takes effect immediately.
 */
export async function hasCreditsLeft(organizationId: string, needed: number): Promise<boolean> {
  const plan = await resolveEntitlements(organizationId);
  const allowance = (plan.entitlements as Record<string, unknown>).creativeCredits;
  if (allowance === null || allowance === undefined) return true;
  const limit = Number(allowance);
  if (!Number.isFinite(limit)) return true;
  return (await creditsUsedThisMonth(organizationId)) + needed <= limit;
}

export async function assertCredits(organizationId: string, needed: number) {
  const plan = await resolveEntitlements(organizationId);
  const allowance = (plan.entitlements as Record<string, unknown>).creativeCredits;
  if (allowance === null || allowance === undefined) return;
  const limit = Number(allowance);
  if (!Number.isFinite(limit)) return;
  const used = await creditsUsedThisMonth(organizationId);
  if (used + needed > limit) {
    throw new ForbiddenError(`That would use ${used + needed} of this month's ${limit} creative credits.`);
  }
}

/**
 * Delete a pack and the files it owned.
 *
 * The rows go by cascade; the files do not, and nothing else was ever going to remove them. A
 * workspace that makes and discards a pack a day was leaving half a megabyte behind each time, in a
 * bucket somebody pays for, with no way to tell an orphan from a live file after the row was gone.
 *
 * Only the pack's own files. Generated grounds live under a shared, content-addressed prefix because
 * two packs asking for the same abstract field share one file — deleting those with the pack that
 * happened to be first would blank a frame in somebody else's.
 */
export async function deletePack(packId: string, actorId?: string | null) {
  const pack = await getPack(packId);
  const keys = pack.assets.map((asset) => asset.storageKey).filter((key): key is string => Boolean(key));
  await db.delete(s.creativePacks).where(eq(s.creativePacks.id, packId));
  await forget(keys);
  await audit({
    action: "creative.pack.delete",
    entityType: "SETTING",
    entityId: packId,
    organizationId: pack.organizationId,
    userId: actorId ?? null,
    metadata: { name: pack.name, files: keys.length },
  });
}

/**
 * Remove files, and never fail the caller over it.
 *
 * A delete that cannot reach the bucket must not undo a delete that already succeeded in the
 * database: the row is gone either way, and a leaked file is a smaller problem than a pack that
 * reappears. Logged so it is a known leak rather than an invisible one.
 */
async function forget(keys: string[]) {
  if (!keys.length) return;
  const storage = await getStorage();
  await Promise.all(
    keys.map((key) =>
      storage.delete(key).catch((error: unknown) => {
        log.warn("could not remove a stored file", { key, error: error instanceof Error ? error.message : String(error) });
      }),
    ),
  );
}


/**
 * What a pack's quality check says right now.
 *
 * Recomputed from the stored spec rather than stored alongside it: the spec is the thing that was
 * approved, and a saved verdict is a second copy that can disagree with it after a code change.
 */
export function qaFor(pack: { spec: unknown; brief: unknown }): { findings: Finding[]; verdict: ReturnType<typeof verdict> } {
  if (!pack.spec) return { findings: [], verdict: { ok: false, summary: "Not composed yet" } };
  const findings = inspect(pack.spec as Parameters<typeof inspect>[0], (pack.brief ?? null) as Parameters<typeof inspect>[1]);
  return { findings, verdict: verdict(findings) };
}

/** Direct a pack from an edition's own stories, then compose and queue the render. */
export async function generatePack(input: { packId: string; actorId?: string | null; angle?: string | null }) {
  const pack = await getPack(input.packId);
  const record = await activeBrand(pack.organizationId);
  if (!record) throw new NotFoundError("Brand");
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, pack.organizationId), columns: { name: true } });

  // Directing is the one step that always costs a credit, so it is the one step that checks. The
  // check is before the spend rather than after it: a ledger that records an overspend is an audit
  // trail, not a limit.
  await assertCredits(pack.organizationId, 1);

  await db.update(s.creativePacks).set({ status: "DIRECTING", error: null, updatedAt: new Date() }).where(eq(s.creativePacks.id, pack.id));

  const stories = await sourceStories(pack);
  // Photographs the Art Director may place. Only in the modes that use the organisation's own
  // media, and only ones cleared to publish — a picture with rights still to confirm is a picture
  // that cannot go on a public feed, whatever it would do for the frame.
  const media = MODES[pack.mode].usesOwnMedia ? await sourceMedia(pack, stories.map((story) => story.id)) : [];
  const { briefFor } = await import("@/server/ai/services/art-director");
  const directed = await briefFor({
    format: pack.format,
    mode: pack.mode,
    organizationName: organization?.name ?? "",
    brand: record.system,
    stories,
    media,
    angle: input.angle ?? null,
  });

  if (directed.costCents > 0) {
    await recordCost({ organizationId: pack.organizationId, packId: pack.id, provider: "openai", operation: "direct", costCents: directed.costCents, credits: 1 });
  }

  const updated = await setBrief({ packId: pack.id, brief: directed.brief, actorId: input.actorId });
  if (updated.status !== "FAILED") {
    const { enqueueRender } = await import("./jobs");
    await enqueueRender(updated, input.actorId);
  }
  return { pack: updated, source: directed.source };
}

/**
 * The material a pack is made from.
 *
 * An edition's selected stories in running order, or one story on its own. Deliberately reads the
 * published editorial rather than the raw submissions: a carousel is made from what the newsroom
 * decided to say, not from what arrived.
 */
async function sourceStories(pack: CreativePack) {
  const stories = pack.storyId
    ? await db.query.stories.findMany({ where: eq(s.stories.id, pack.storyId) })
    : pack.editionId
      ? await db.query.stories.findMany({
          where: and(eq(s.stories.editionId, pack.editionId), eq(s.stories.status, "SELECTED")),
          orderBy: [s.stories.createdAt],
          limit: 8,
        })
      : [];
  if (!stories.length) return [];

  // The written article, where there is one. A carousel made from headlines alone has nothing to
  // quote and no number to show, and comes out as a list — which is what the thin version looked
  // like before this join existed.
  const articles = await db.query.articles.findMany({
    where: inArray(s.articles.storyId, stories.map((story) => story.id)),
    columns: { storyId: true, headline: true, standfirst: true, body: true },
  });
  const byStory = new Map(articles.map((article) => [article.storyId, article]));

  return stories.map((story) => {
    const article = byStory.get(story.id);
    const blocks = article?.body ?? [];
    const paragraphs = blocks.filter((block): block is Extract<typeof block, { type: "paragraph" }> => block.type === "paragraph");
    const pullQuotes = blocks.filter((block): block is Extract<typeof block, { type: "pullquote" }> => block.type === "pullquote");
    const testimony = blocks.filter((block): block is Extract<typeof block, { type: "testimony" }> => block.type === "testimony");

    return {
      id: story.id,
      headline: article?.headline || story.title,
      standfirst: article?.standfirst ?? story.summary,
      body: paragraphs.slice(0, 3).map((block) => block.text).join(" ") || null,
      section: null,
      // Numbers worth a slide of their own: money, percentages, multiples and counts with a unit.
      figures: extractFigures([article?.standfirst, ...paragraphs.slice(0, 4).map((block) => block.text)].filter(Boolean).join(" ")),
      quotes: [
        ...pullQuotes.map((block) => ({ text: block.text, attribution: block.attribution ?? "" })),
        ...testimony.map((block) => ({ text: block.text, attribution: block.speaker ?? "" })),
      ]
        .filter((quote) => quote.attribution && quote.text.length > 20 && quote.text.length < 180)
        .slice(0, 2),
    };
  });
}

/**
 * The organisation's own photographs, offered by id with a line describing each.
 *
 * `briefFor` had accepted a media list from the start and was never handed one, so the modes built
 * around "your own pictures" could not place a single picture and the two image layouts were
 * unreachable from the interface. This is the join that was missing.
 *
 * The stories' own pictures first, in the order the newsroom put them, then the rest of the
 * edition's library. GREEN rights only: YELLOW means "confirm with the contributor", and a social
 * post is the one place nobody will. The description is whatever a person wrote, falling back to
 * what the vision pass saw — never the file name, which a model would happily quote on a slide.
 */
async function sourceMedia(pack: CreativePack, storyIds: string[]): Promise<{ id: string; description: string; orientation: string | null }[]> {
  const linked = storyIds.length
    ? await db
        .select({ id: s.mediaAssets.id, altText: s.mediaAssets.altText, caption: s.mediaAssets.caption, aiDescription: s.mediaAssets.aiDescription, orientation: s.mediaAssets.orientation, kind: s.mediaAssets.kind, rightsStatus: s.mediaAssets.rightsStatus, isArchived: s.mediaAssets.isArchived, order: s.storyMedia.sortOrder })
        .from(s.storyMedia)
        .innerJoin(s.mediaAssets, eq(s.mediaAssets.id, s.storyMedia.mediaAssetId))
        .where(inArray(s.storyMedia.storyId, storyIds))
        .orderBy(s.storyMedia.sortOrder)
    : [];
  const fromEdition = pack.editionId
    ? await db.query.mediaAssets.findMany({
        where: and(eq(s.mediaAssets.editionId, pack.editionId), eq(s.mediaAssets.organizationId, pack.organizationId)),
        columns: { id: true, altText: true, caption: true, aiDescription: true, orientation: true, kind: true, rightsStatus: true, isArchived: true },
        limit: 40,
      })
    : [];

  const seen = new Set<string>();
  const offered: { id: string; description: string; orientation: string | null }[] = [];
  for (const asset of [...linked, ...fromEdition]) {
    // The shared rule first — no logo, nothing archived, nothing refused or too small to use.
    // Then this pass's own stricter one: a public post carries only settled rights, and only the
    // shapes that read at a glance on a phone.
    if (seen.has(asset.id) || !canIllustrate(asset) || asset.rightsStatus !== "GREEN") continue;
    if (asset.kind && !["photo", "diagram", "chart"].includes(asset.kind)) continue;
    const description = (asset.altText || asset.caption || asset.aiDescription || "").trim();
    if (!description) continue;
    seen.add(asset.id);
    offered.push({ id: asset.id, description: description.slice(0, 160), orientation: asset.orientation ?? null });
    if (offered.length >= 12) break;
  }
  return offered;
}

/**
 * Numbers that would carry a slide.
 *
 * Deliberately narrow: a figure frame sets one number enormous, and "2023" or "the 12 students" do
 * not deserve that. What does is money, a percentage, a multiple, or a count with a unit attached —
 * the things a reader stops scrolling for. Taken verbatim from the text, never reformatted, because
 * a number rewritten is a number that might no longer be the one the newsroom checked.
 */
export function extractFigures(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /[€$£]\s?\d[\d.,]*\s?(?:k|m|bn|M|K|Bn)?/g,
    /\d[\d.,]*\s?%/g,
    /\d[\d.,]*\s?×/g,
    /\b\d[\d.,]*\s?(?:students|alumni|companies|startups|countries|campuses|hours|years|projects)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0].trim();
      if (value.length <= 24) found.add(value);
      if (found.size >= 3) return [...found];
    }
  }
  return [...found];
}

/* ── Housekeeping ─────────────────────────────────────────────────────────────────────────── */

export const GENERATED_PREFIX = "creative/generated/";

/**
 * Remove generated grounds nothing refers to any more.
 *
 * A ground is content-addressed and shared, so it cannot go with the pack that made it — another
 * pack may be using it. That left it with no owner and no end: a brand that changed its accent once
 * a month left twelve fields a year in the bucket, forever. This is the end.
 *
 * "Referenced" means named by the spec of any pack that still exists, in any organisation. A file
 * newer than the grace period is kept whether or not it is referenced, because a render in flight has
 * written the ground and not yet saved the spec that names it, and deleting it from under that render
 * is exactly the kind of race a nightly job produces and nobody can reproduce.
 */
export async function pruneGeneratedGrounds(options: { dryRun?: boolean; graceHours?: number } = {}): Promise<{ kept: number; removed: string[]; referenced: number }> {
  const storage = await getStorage();
  const stored = await storage.list(GENERATED_PREFIX);

  const packs = await db.query.creativePacks.findMany({ columns: { spec: true } });
  const referenced = new Set<string>();
  for (const pack of packs) {
    for (const frame of pack.spec?.frames ?? []) {
      const key = frame.image?.generate?.key;
      if (key) referenced.add(`${GENERATED_PREFIX}${key}.jpg`);
    }
  }

  const graceMs = (options.graceHours ?? 24) * 3_600_000;
  const removed: string[] = [];
  for (const key of stored) {
    if (referenced.has(key)) continue;
    if (await isYoungerThan(storage, key, graceMs)) continue;
    removed.push(key);
    if (!options.dryRun) await storage.delete(key).catch((error: unknown) => log.warn("could not prune a ground", { key, error: error instanceof Error ? error.message : String(error) }));
  }
  return { kept: stored.length - removed.length, removed, referenced: referenced.size };
}

/** Whether a stored file was written recently. Only disk can say; anything else is treated as old. */
async function isYoungerThan(storage: StorageAdapter, key: string, ms: number): Promise<boolean> {
  if (!storage.localPath) return false;
  try {
    const { promises: fs } = await import("node:fs");
    const stat = await fs.stat(storage.localPath(key));
    return Date.now() - stat.mtimeMs < ms;
  } catch {
    return false;
  }
}
