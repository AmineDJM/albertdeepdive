import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { getStorage } from "@/server/storage";
import { JOB_TYPES, registerJobHandler, type JobContext } from "@/server/jobs/registry";
import { activeBrand } from "@/server/brand/service";
import { runAsOrganization } from "@/server/tenancy/context";
import { recordCost } from "@/server/creative/service";
import { ingestMedia } from "@/server/media/ingest";
import { planImage } from "@/server/ai/services/image-planner";
import { visionQa } from "@/server/ai/services/image-qa";
import { estimateCostCents } from "@/server/ai/pricing";
import { accumulateSpec, heuristicPlan, promptFor, reconcilePlans, shouldRegenerate, type PlanContext } from "@/lib/images/plan";
import { route } from "@/lib/images/router";
import { assessImage, variationsFor } from "@/lib/images/qa";
import type { ImageEditPlan, ReferenceRole } from "@/lib/images/types";
import { SIZES, lineage, modelStats, type ImageVersionRow } from "./service";
import { availableModels, imageEngineConfig, imageProvider, type ImageProvider, type ImageRequest } from "./providers";
import { ImageProviderError, type ImageReferenceInput } from "./providers/types";

const log = createLogger("image-jobs");

/**
 * Making a picture, off the request.
 *
 * Plan, route, ask, check, keep. The plan is the contract: what changes, what must not, how
 * carefully. The router turns it into an ordered list of models that can honour it. Each candidate
 * is asked, its answer is measured against the version before and, when a model that can see is
 * connected, looked at; an answer that fails is a retry of the same model up to the policy, then
 * the next model. Every attempt is written down with its cost and its score, which is the ledger
 * routing will be tuned from.
 *
 * For a sensitive subject that has been through several edits, the next one starts again from the
 * master and the accumulated specification, not from the last raster — the founder's face is
 * regenerated from the founder's photograph, not from a copy of a copy.
 */

type Payload = { versionId: string };
type Asset = typeof s.mediaAssets.$inferSelect;

const PEOPLE = /\b(person|people|portrait|face|team|founder|student|speaker|woman|man|crowd|group|smiling|headshot|ceo|staff|employee)\b/i;
const PRODUCT = /\b(product|packaging|bottle|device|phone|laptop|box|label|screen|can|shoe|bag|hardware)\b/i;
const ARCHITECTURE = /\b(building|campus|facade|office|interior|lobby|architecture|room|hall|storefront)\b/i;
const TEXT = /\b(text|poster|sign|slide|screenshot|document|chart)\b/i;

/** What is in the picture, from what the library already knows about it. */
export function subjectOf(assets: Asset[]): PlanContext["subject"] {
  const words = assets.map((asset) => [asset.aiDescription, asset.caption, asset.altText, ...asset.aiTags, asset.kind].filter(Boolean).join(" ")).join(" ");
  return {
    people: PEOPLE.test(words),
    product: PRODUCT.test(words),
    logo: assets.some((asset) => asset.kind === "logo") || /\blogo\b/i.test(words),
    architecture: ARCHITECTURE.test(words),
    text: assets.some((asset) => asset.kind === "screenshot" || asset.kind === "chart" || asset.kind === "document") || TEXT.test(words),
  };
}

function describeSubject(assets: Asset[]): string {
  return assets.map((asset) => [asset.kind, asset.aiDescription ?? asset.caption ?? asset.fileName, asset.aiTags.length ? `tags: ${asset.aiTags.join(", ")}` : null].filter(Boolean).join(" · ")).join(" | ");
}

/** The picture's bytes at a size a model will accept, and never the original file's 30 MB. */
async function bytesFor(asset: Asset): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number }> {
  const raw = await getStorage().get(asset.storageKey);
  if (!raw) throw new Error(`The file for ${asset.fileName} is missing from storage.`);
  const image = sharp(raw, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  const png = await (longest > 2048 ? image.resize(2048, 2048, { fit: "inside" }) : image).png().toBuffer();
  const out = await sharp(png).metadata();
  return { bytes: png, mimeType: "image/png", width: out.width ?? meta.width ?? 1024, height: out.height ?? meta.height ?? 1024 };
}

/** A mask the size of the picture: opaque where it stays, transparent where it may change. */
export async function maskFor(width: number, height: number, region: NonNullable<ImageEditPlan["region"]>): Promise<Buffer> {
  const left = Math.max(0, Math.round(region.x * width));
  const top = Math.max(0, Math.round(region.y * height));
  const w = Math.max(1, Math.min(width - left, Math.round(region.width * width)));
  const h = Math.max(1, Math.min(height - top, Math.round(region.height * height)));
  // `dest-out` punches the destination wherever the source is opaque: the hole is drawn solid.
  const hole = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([{ input: hole, left, top, blend: "dest-out" }])
    .png()
    .toBuffer();
}

const RIGHTS_RANK = { GREEN: 0, YELLOW: 1, RED: 2 } as const;

async function setStatus(id: string, status: ImageVersionRow["status"], extra: Partial<typeof s.imageVersions.$inferInsert> = {}) {
  await db.update(s.imageVersions).set({ status, updatedAt: new Date(), ...extra }).where(eq(s.imageVersions.id, id));
}

export async function runImageVersion(payload: Payload, ctx?: JobContext): Promise<{ status: string; provider: string | null }> {
  const version = await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, payload.versionId) });
  if (!version) throw new Error("Image version not found");
  // The worker has no cookie: the version's workspace is declared so every picture it files lands there.
  return runAsOrganization(version.organizationId, () => makeVersion(version, ctx));
}

async function makeVersion(version: ImageVersionRow, ctx?: JobContext): Promise<{ status: string; provider: string | null }> {
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, version.organizationId), columns: { id: true, name: true } });
  if (!organization) throw new Error("Workspace not found");
  const config = await imageEngineConfig();
  const attempts: ImageVersionRow["attempts"] = [];
  const started = Date.now();

  try {
    await setStatus(version.id, "RUNNING", { error: null });
    await ctx?.progress(0, 4, "planning");

    // ── What is being worked on ──
    const isEdit = version.operation !== "generate";
    const line = version.rootId ? await lineage(version.rootId) : [];
    const parent = version.parentId ? (line.find((row) => row.id === version.parentId) ?? (await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, version.parentId) }))) : null;
    const root = version.rootId ? (line.find((row) => row.id === version.rootId) ?? null) : null;
    if (isEdit && (!parent?.mediaId || parent.status !== "READY")) throw new Error("The version to edit has no picture.");
    const assetIds = [...new Set([parent?.mediaId, root?.mediaId, ...version.references.map((reference) => reference.mediaId)].filter((id): id is string => Boolean(id)))];
    const assets = assetIds.length ? await db.query.mediaAssets.findMany({ where: inArray(s.mediaAssets.id, assetIds) }) : [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const parentAsset = parent?.mediaId ? assetById.get(parent.mediaId) ?? null : null;
    const rootAsset = root?.mediaId ? assetById.get(root.mediaId) ?? null : null;

    // References on offer: the picture itself, the master it descends from, and whatever the person added.
    const explicit = version.references.filter((reference) => assetById.has(reference.mediaId));
    const offered: ReferenceRole[] = [...new Set<ReferenceRole>([...(isEdit ? (["current_version"] as ReferenceRole[]) : []), ...(isEdit && rootAsset && rootAsset.id !== parentAsset?.id ? (["original_master"] as ReferenceRole[]) : []), ...explicit.map((reference) => reference.role)])];
    const request = (version.debug as { request?: { size?: keyof typeof SIZES; advanced?: { latitude?: number; variations?: number | null; realism?: number | null } } }).request ?? {};
    const brand = await activeBrand(version.organizationId).catch(() => null);
    const brandNotes = brand ? { palette: [brand.system.colours.brand, brand.system.colours.accent, brand.system.colours.paper], photographyStyle: brand.system.imagery.treatment === "mono" ? "black and white" : brand.system.imagery.treatment === "editorial" ? "editorial, natural light" : null, avoid: brand.system.voice.avoid } : null;
    const context: PlanContext = { isEdit, subject: subjectOf([parentAsset, ...explicit.map((reference) => assetById.get(reference.mediaId)!)].filter((asset): asset is Asset => Boolean(asset))), wantsVector: /\b(vector|svg|icon)\b/i.test(version.instruction), latitude: request.advanced?.latitude ?? 0, offered };

    // ── The plan: the rules' floor, raised by a model when one is connected ──
    const floor = heuristicPlan(version.instruction, context);
    let plan: ImageEditPlan = floor;
    try {
      const planned = await planImage(
        { organizationName: organization.name, instruction: version.instruction, isEdit, subject: describeSubject(parentAsset ? [parentAsset] : []), offered, brand: brandNotes ? `palette ${brandNotes.palette.join(", ")}${brandNotes.avoid.length ? `; avoid ${brandNotes.avoid.join(", ")}` : ""}` : "", floor: { operation: floor.operation, task: floor.task, sensitivity: floor.sensitivity, preserve: floor.preserve } },
        { editionId: version.editionId, jobId: ctx?.job.id ?? null, cacheable: false },
      );
      plan = reconcilePlans(planned.output, floor, context);
      // The rules write the prompt when no model did; a model's own prompt keeps the brand's notes appended.
      if (planned.provider === "local" || !plan.prompt.trim()) plan = { ...plan, source: planned.provider === "local" ? "local" : plan.source, prompt: promptFor(plan, { instruction: version.instruction, brand: brandNotes }) };
      else if (brandNotes?.avoid.length && !plan.prompt.includes("Avoid:")) plan = { ...plan, prompt: `${plan.prompt} Avoid: ${brandNotes.avoid.join(", ")}.` };
    } catch (error) {
      log.warn("planner failed; the rules' plan stands", { versionId: version.id, error: error instanceof Error ? error.message : String(error) });
    }
    if ((request.advanced?.latitude ?? 0) > 0.5 && plan.sensitivity !== "HIGH") plan = { ...plan, preserve: plan.preserve.filter((line) => !/lighting|composition/.test(line)) };

    // ── Regenerate from the master rather than edit a copy of a copy ──
    let operation: "generate" | "edit" | "regenerate" = isEdit ? "edit" : "generate";
    if (isEdit && root && rootAsset && parent) {
      const chain: ImageVersionRow[] = [];
      let cursor: ImageVersionRow | null = parent;
      while (cursor && cursor.id !== root.id) {
        chain.unshift(cursor);
        cursor = cursor.parentId ? (line.find((row) => row.id === cursor!.parentId) ?? null) : null;
      }
      const editsSinceMaster = chain.filter((row) => row.operation !== "regenerate").length;
      if (shouldRegenerate(plan.sensitivity, editsSinceMaster)) {
        const spec = accumulateSpec([...chain.map((row) => row.plan), plan]);
        plan = { ...plan, operation: "regenerate", change: spec.change, preserve: spec.preserve, references: [...new Set<ReferenceRole>(["original_master", ...plan.references.filter((role) => role !== "current_version")])] };
        plan = { ...plan, prompt: promptFor(plan, { instruction: spec.change.join(". "), brand: brandNotes }) };
        operation = "regenerate";
      }
    }

    // ── The references, as bytes ──
    const references: ImageReferenceInput[] = [];
    const referenceRows: ImageVersionRow["references"] = [];
    const add = async (role: ReferenceRole, asset: Asset | null | undefined) => {
      if (!asset || referenceRows.some((row) => row.mediaId === asset.id && row.role === role)) return;
      const loaded = await bytesFor(asset);
      references.push({ role, bytes: loaded.bytes, mimeType: loaded.mimeType });
      referenceRows.push({ role, mediaId: asset.id });
    };
    if (plan.references.includes("current_version") && operation !== "regenerate") await add("current_version", parentAsset);
    if (plan.references.includes("original_master") || operation === "regenerate") await add("original_master", rootAsset ?? parentAsset);
    for (const reference of explicit) if (plan.references.includes(reference.role) || !isEdit) await add(reference.role, assetById.get(reference.mediaId));
    if (isEdit && !references.length) await add("current_version", parentAsset);

    // ── Size, mask, how many ──
    const size = isEdit && parentAsset?.width && parentAsset?.height ? { width: Math.min(2048, parentAsset.width), height: Math.min(2048, parentAsset.height) } : SIZES[request.size ?? "landscape"];
    const base = references.find((reference) => reference.role === (operation === "regenerate" ? "original_master" : "current_version"));
    const baseSize = base ? await sharp(base.bytes).metadata() : null;
    const canvas = baseSize?.width && baseSize?.height ? { width: baseSize.width, height: baseSize.height } : size;
    const mask = plan.region && operation !== "regenerate" ? await maskFor(canvas.width, canvas.height, plan.region) : null;
    const n = variationsFor(plan, request.advanced?.variations ?? config.defaultVariations);

    // ── Route ──
    const available = await availableModels(config.registry);
    const decision = route({ plan, routing: config.routing, available, registry: config.registry, stats: await modelStats(version.organizationId), referenceCount: references.length, needsMask: false });
    if (!decision.candidates.length) throw new Error(`No connected picture service can do this (${Object.entries(decision.reasons).map(([key, reason]) => `${key}: ${reason}`).join("; ") || "nothing connected"}).`);
    await ctx?.progress(1, 4, `asking ${decision.candidates[0].label}`);
    const rights = [parentAsset, rootAsset, ...explicit.map((reference) => assetById.get(reference.mediaId))].filter((asset): asset is Asset => Boolean(asset)).reduce<"GREEN" | "YELLOW" | "RED">((worst, asset) => (RIGHTS_RANK[asset.rightsStatus] > RIGHTS_RANK[worst] ? asset.rightsStatus : worst), "GREEN");
    // A regeneration is measured against the master it was made from, not the raster it replaces.
    const beforeAsset = operation === "regenerate" ? (rootAsset ?? parentAsset) : parentAsset;
    const before = beforeAsset && operation !== "generate" ? { phash: beforeAsset.phash, bytes: base ?? null } : null;

    // ── Ask, check, keep ──
    let kept: { asset: Asset; qa: ReturnType<typeof assessImage>; provider: ImageProvider; model: string; modelKey: string; cost: number; extras: { asset: Asset; qa: ReturnType<typeof assessImage> }[] } | null = null;
    let lastIssue = "";
    candidates: for (const candidate of decision.candidates) {
      const provider = await imageProvider(candidate.provider);
      if (!provider) continue;
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        const at = Date.now();
        try {
          const call: ImageRequest = { model: candidate.model, prompt: plan.prompt, width: canvas.width, height: canvas.height, references: references.slice(0, Math.max(candidate.maxReferences, isEdit ? 1 : 0)), mask: candidate.supportsMask ? mask : null, n, seed: attempt ? attempt * 7919 : null, output: candidate.outputs.includes(plan.output) ? plan.output : "raster", palette: brandNotes?.palette };
          const result = isEdit && provider.edit && candidate.operations.includes("edit") ? await provider.edit(call) : await provider.generate(call);
          const latencyMs = Date.now() - at;
          const checked: { asset: Asset; qa: ReturnType<typeof assessImage> }[] = [];
          for (const [index, image] of result.images.entries()) {
            const ingested = await ingestMedia({
              buffer: image.mimeType === "image/svg+xml" ? await sharp(image.bytes).png().toBuffer() : image.bytes,
              fileName: `${version.label.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "picture"}-v${version.version}${index ? `-${index + 1}` : ""}.png`,
              mimeType: "image/png",
              editionId: version.editionId,
              userId: version.createdById,
              caption: version.label,
              altText: plan.change.join("; ").slice(0, 400),
              rightsStatus: rights,
              rightsNote: `Made by Briefly from “${version.instruction.slice(0, 120)}”.`,
              kind: plan.task === "illustration" ? "diagram" : "photo",
              skipDuplicateCheck: true,
            });
            await db.update(s.mediaAssets).set({ aiTags: [...new Set([...ingested.asset.aiTags, "generated"])], metadata: { ...ingested.asset.metadata, generated: true, imageVersionId: version.id, provider: provider.name, model: result.model } }).where(eq(s.mediaAssets.id, ingested.asset.id));
            let vision = null;
            if (config.visionQa && (plan.sensitivity !== "LOW" || context.subject.people || PEOPLE.test(version.instruction))) {
              try {
                const seen = await visionQa({ plan, before: before?.bytes ? { bytes: before.bytes.bytes, mimeType: before.bytes.mimeType } : null, after: { bytes: image.mimeType === "image/svg+xml" ? await sharp(image.bytes).png().toBuffer() : image.bytes, mimeType: image.mimeType === "image/svg+xml" ? "image/png" : image.mimeType } });
                if (seen) {
                  vision = seen.output;
                  await recordCost({ organizationId: version.organizationId, provider: "openai", operation: "image-qa", model: seen.model, costCents: estimateCostCents(seen.model, seen.inputTokens, seen.outputTokens) });
                }
              } catch (error) {
                log.warn("vision QA failed; the numbers stand", { versionId: version.id, error: error instanceof Error ? error.message : String(error) });
              }
            }
            const qa = assessImage({ plan, before: before ? { phash: before.phash } : null, after: { phash: ingested.asset.phash, width: ingested.asset.width ?? 0, height: ingested.asset.height ?? 0 }, vision, passAt: config.qaPassAt, retryBelow: config.qaRetryBelow });
            checked.push({ asset: ingested.asset, qa });
          }
          const best = [...checked].sort((a, b) => b.qa.score - a.qa.score)[0];
          attempts.push({ provider: provider.name, model: result.model, latencyMs, error: null, qaScore: best?.qa.score ?? null, modelKey: candidate.key } as ImageVersionRow["attempts"][number]);
          await recordCost({ organizationId: version.organizationId, provider: provider.name, operation: isEdit ? "image-edit" : "image-generate", model: result.model, units: result.images.length, unit: "image", costCents: result.costCents, credits: result.images.length });
          if (best && best.qa.verdict === "pass") {
            kept = { asset: best.asset, qa: best.qa, provider, model: result.model, modelKey: candidate.key, cost: result.costCents, extras: checked.filter((entry) => entry !== best && entry.qa.verdict === "pass") };
            for (const entry of checked.filter((entry) => entry !== best && entry.qa.verdict !== "pass")) await db.update(s.mediaAssets).set({ isArchived: true }).where(eq(s.mediaAssets.id, entry.asset.id));
            break candidates;
          }
          lastIssue = best?.qa.issues.join(" ") || "The picture did not pass the check.";
          for (const entry of checked) await db.update(s.mediaAssets).set({ isArchived: true }).where(eq(s.mediaAssets.id, entry.asset.id));
          if (best?.qa.verdict === "fail") break; // this model is not going to get there; the next may
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          attempts.push({ provider: provider.name, model: candidate.model, latencyMs: Date.now() - at, error: message.slice(0, 300), qaScore: null, modelKey: candidate.key } as ImageVersionRow["attempts"][number]);
          lastIssue = message;
          if (error instanceof ImageProviderError && !error.retryable) break;
        }
      }
    }

    if (!kept) throw new Error(lastIssue ? `Could not make a picture that passes the check: ${lastIssue}` : "Could not make the picture.");

    // ── Keep it ──
    const rootId = version.rootId ?? version.id;
    await db.update(s.imageVersions).set({ isCurrent: false, updatedAt: new Date() }).where(inArray(s.imageVersions.id, [rootId, ...line.map((row) => row.id)]));
    await setStatus(version.id, "READY", {
      mediaId: kept.asset.id,
      operation,
      plan,
      references: referenceRows,
      sensitivity: plan.sensitivity,
      provider: kept.provider.name,
      model: kept.model,
      attempts,
      retries: Math.max(0, attempts.length - 1),
      latencyMs: Date.now() - started,
      costCents: String(attempts.length ? kept.cost : 0),
      qa: kept.qa,
      isCurrent: true,
      debug: { ...(version.debug as Record<string, unknown>), modelKey: kept.modelKey, candidates: decision.candidates.map((candidate) => candidate.key), reasons: decision.reasons, prompt: plan.prompt, required: decision.required, mask: Boolean(mask), variations: n },
    });
    for (const [index, extra] of kept.extras.entries()) {
      await db.insert(s.imageVersions).values({ organizationId: version.organizationId, editionId: version.editionId, rootId, parentId: version.parentId, version: version.version, label: `${version.label} · ${index + 2}`, mediaId: extra.asset.id, operation, instruction: version.instruction, plan, references: referenceRows, sensitivity: plan.sensitivity, status: "READY", provider: kept.provider.name, model: kept.model, qa: extra.qa, latencyMs: Date.now() - started, costCents: "0", debug: { modelKey: kept.modelKey, variationOf: version.id }, createdById: version.createdById });
    }
    await audit({ action: "image.version.ready", organizationId: version.organizationId, userId: version.createdById, editionId: version.editionId, metadata: { versionId: version.id, version: version.version, operation, provider: kept.provider.name, model: kept.model, sensitivity: plan.sensitivity, qa: kept.qa.score, attempts: attempts.length } });
    log.info("picture ready", { versionId: version.id, provider: kept.provider.name, model: kept.model, qa: kept.qa.score, attempts: attempts.length });
    return { status: "READY", provider: kept.provider.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setStatus(version.id, "FAILED", { error: message.slice(0, 500), attempts, retries: Math.max(0, attempts.length - 1), latencyMs: Date.now() - started });
    await audit({ action: "image.version.failed", organizationId: version.organizationId, userId: version.createdById, editionId: version.editionId, metadata: { versionId: version.id, error: message.slice(0, 200), attempts: attempts.length } });
    throw error;
  }
}

registerJobHandler<Payload, { status: string; provider: string | null }>(JOB_TYPES.IMAGE_RENDER, (payload, ctx) => runImageVersion(payload, ctx));
