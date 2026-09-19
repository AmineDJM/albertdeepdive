import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { deltaE00, deltaE00Lab, labOf, srgbToLab, type Lab } from "@/lib/brand/deltae";
import { FORMATS, type CreativeFormat } from "@/lib/creative/formats";
import type { FrameSpec, RenderSpec } from "@/lib/creative/brief";
import { ffmpegPath } from "@/server/creative/video";
import { BRAND_COLOUR_DECLARED, BRAND_COLOUR_RENDERED, FRAME_CANVAS, FRAME_DECODES, VIDEO_CANVAS, VIDEO_DECODES, VIDEO_DURATION } from "../spec";
import { assertThat, compare, merge, nothing, type CheckResult } from "../types";
import type { Check, QcContext } from "../engine";

/**
 * The brand, and the files the studio makes of it.
 *
 * Two questions that look like taste and are not. The first is whether the colour every renderer
 * compiles from is still the colour the customer declared — two places store it, only one of them
 * is read when a frame is drawn, and nothing until now noticed when they parted company. The
 * second is whether the file on disk is the file the spec describes: the right size, the right
 * length, decodable at all, and painted in the colours it was told to paint.
 *
 * ΔE00 rather than "close enough": ≤2 is the tolerance commercial print already uses for a match,
 * and a number with a published tolerance is arguable in a way "looks a bit off" is not. It is
 * applied only to flat colour the renderer was instructed to lay down — never to a photograph,
 * where the brand has no business dictating pixels.
 */

/* ── Brand colour ─────────────────────────────────────────────────────────────────────────── */

/** The declared role in Settings, and the role it becomes in the compiled brand. */
const ROLES = [
  { declared: "primary", system: "brand", label: "primary" },
  { declared: "accent", system: "accent", label: "accent" },
  { declared: "ink", system: "ink", label: "ink" },
  { declared: "paper", system: "paper", label: "paper" },
] as const;

export const brandCheck: Check = {
  id: "brand",
  title: "The brand is the colour the customer declared, and the file is painted in it",
  async run(ctx: QcContext): Promise<CheckResult> {
    if (!ctx.organizationId) return nothing();
    const organization = await db.query.organizations.findFirst({
      where: eq(s.organizations.id, ctx.organizationId),
      columns: { id: true, name: true, brandColours: true },
    });
    const system = await db.query.brandSystems.findFirst({
      where: and(eq(s.brandSystems.organizationId, ctx.organizationId), eq(s.brandSystems.isActive, true)),
    });
    const results: CheckResult[] = [];

    // ── the two places a brand colour is kept, compared ────────────────────────────────────
    const declared = (organization?.brandColours ?? {}) as Record<string, string | undefined>;
    const compiled = (system?.system.colours ?? {}) as Record<string, string | undefined>;
    const comparisons = ROLES.flatMap((role) => {
      const one = declared[role.declared];
      const two = compiled[role.system];
      if (!one || !two) return [];
      const distance = deltaE00(one, two);
      // A colour neither side can parse is a different defect, and reporting it as a distance of
      // zero would be the wrong answer to the wrong question.
      return distance === null ? [] : [{ role: role.label, declared: one, compiled: two, distance }];
    });

    if (comparisons.length && system) {
      const worst = comparisons.reduce((top, each) => (each.distance > top.distance ? each : top));
      results.push(
        compare({
          spec: BRAND_COLOUR_DECLARED,
          actual: worst.distance,
          location: { entityType: "workspace", entityId: ctx.organizationId, field: worst.role },
          message:
            worst.distance > 2
              ? `The ${worst.role} colour in settings is ${worst.declared}, but everything is drawn from the brand's ${worst.compiled} — ${worst.distance.toFixed(1)} ΔE00 apart.`
              : `Every declared brand colour survives into the brand everything is drawn from.`,
          evidence: { roles: comparisons.map((each) => ({ ...each, distance: Math.round(each.distance * 100) / 100 })) },
        }),
      );
    }

    // ── the colours the files were actually painted ────────────────────────────────────────
    results.push(await renderedColours(ctx));
    return merge(...results);
  },
};

/** How many packs and frames one run looks at. A quality check may not become a render farm. */
const PACK_LIMIT = 3;
const FRAME_LIMIT = 5;
/** A fill smaller than this is type-sized furniture, not a brand element, and is not measured. */
const MIN_FILL_FRACTION = 0.02;

type Fill = { colour: string; area: number; what: string };

/**
 * The flat colours a frame's spec asks for, minus anything a picture covers.
 *
 * Only fills the renderer was told to lay down as solid areas: the frame's ground and its shapes.
 * Type is excluded — a glyph is antialiased into its background and its centre pixel is a blend,
 * so measuring it would report drift on every correctly drawn frame.
 */
function fillsOf(frame: FrameSpec): Fill[] {
  const canvas = frame.width * frame.height;
  if (!canvas) return [];
  const picture = frame.image ? { x: frame.image.x, y: frame.image.y, w: frame.image.width, h: frame.image.height } : null;
  const covers = (x: number, y: number, w: number, h: number) =>
    picture !== null && picture.x <= x && picture.y <= y && picture.x + picture.w >= x + w && picture.y + picture.h >= y + h;

  const fills: Fill[] = [];
  if (!covers(0, 0, frame.width, frame.height)) fills.push({ colour: frame.background, area: canvas, what: "the ground" });
  for (const shape of frame.shapes) {
    const area = Math.max(0, shape.width) * Math.max(0, shape.height);
    if (area / canvas < MIN_FILL_FRACTION) continue;
    if (covers(shape.x, shape.y, shape.width, shape.height)) continue;
    fills.push({ colour: shape.colour, area, what: `a ${shape.kind}` });
  }
  // Same colour twice is the same question twice.
  const seen = new Set<string>();
  return fills.filter((fill) => (seen.has(fill.colour.toLowerCase()) ? false : seen.add(fill.colour.toLowerCase())));
}

/** Every distinct colour in the file, sampled without inventing any. */
async function paletteOf(bytes: Buffer): Promise<Lab[]> {
  // Nearest-neighbour, so the downsample cannot blend two colours into a third that was never
  // painted — which is exactly the false positive an averaging resize would produce.
  const { data, info } = await sharp(bytes).resize(128, 128, { fit: "inside", kernel: "nearest" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const seen = new Set<number>();
  const palette: Lab[] = [];
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const packed = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (seen.has(packed)) continue;
    seen.add(packed);
    palette.push(srgbToLab({ r: data[i], g: data[i + 1], b: data[i + 2] }));
  }
  return palette;
}

async function renderedColours(ctx: QcContext): Promise<CheckResult> {
  const packs = await db
    .select({ id: s.creativePacks.id, name: s.creativePacks.name, spec: s.creativePacks.spec })
    .from(s.creativePacks)
    .where(and(eq(s.creativePacks.organizationId, ctx.organizationId!), isNotNull(s.creativePacks.spec)))
    .orderBy(desc(s.creativePacks.updatedAt))
    .limit(PACK_LIMIT);
  if (!packs.length) return nothing();

  const assets = await db
    .select({ packId: s.creativeAssets.packId, index: s.creativeAssets.index, storageKey: s.creativeAssets.storageKey, mediaId: s.creativeAssets.mediaId, generated: s.creativeAssets.generated })
    .from(s.creativeAssets)
    .where(and(inArray(s.creativeAssets.packId, packs.map((pack) => pack.id)), eq(s.creativeAssets.kind, "FRAME"), eq(s.creativeAssets.status, "READY")));

  const results: CheckResult[] = [];
  for (const pack of packs) {
    const spec = pack.spec as RenderSpec | null;
    if (!spec?.frames?.length) continue;
    const mine = assets.filter((asset) => asset.packId === pack.id && asset.storageKey).slice(0, FRAME_LIMIT);
    for (const asset of mine) {
      const frame = spec.frames.find((each) => each.index === asset.index);
      if (!frame) continue;
      const fills = fillsOf(frame);
      if (!fills.length) continue;
      const bytes = await ctx.storage.get(asset.storageKey!).catch(() => null);
      if (!bytes) continue;
      let palette: Lab[];
      try {
        palette = await paletteOf(bytes);
      } catch {
        // Unreadable is the still-decodes check's finding, not this one's.
        continue;
      }
      if (!palette.length) continue;

      let worst: { fill: Fill; distance: number } | null = null;
      for (const fill of fills) {
        const wanted = labOf(fill.colour);
        if (!wanted) continue;
        let nearest = Number.POSITIVE_INFINITY;
        for (const present of palette) {
          const distance = deltaE00Lab(wanted, present);
          if (distance < nearest) nearest = distance;
          if (nearest === 0) break;
        }
        if (!worst || nearest > worst.distance) worst = { fill, distance: nearest };
      }
      if (!worst) continue;

      results.push(
        compare({
          spec: BRAND_COLOUR_RENDERED,
          actual: worst.distance,
          location: { entityType: "output", entityId: pack.id, entityLabel: pack.name, field: `frame ${asset.index + 1}` },
          message:
            worst.distance > 2
              ? `Frame ${asset.index + 1} of “${pack.name}” asks for ${worst.fill.colour} on ${worst.fill.what}; the nearest colour in the file is ${worst.distance.toFixed(1)} ΔE00 away.`
              : `Frame ${asset.index + 1} of “${pack.name}” carries every colour its spec asked for.`,
          evidence: { fills: fills.length, measured: worst.fill.colour, where: worst.fill.what },
        }),
      );
    }
  }
  return results.length ? merge(...results) : nothing();
}

/* ── Video and fixed-image outputs ────────────────────────────────────────────────────────── */

const VIDEO_LIMIT = 3;
const STILL_LIMIT = 24;
const WINDOW_DAYS = 30;

export const creativeCheck: Check = {
  id: "creative",
  title: "A file the encoder said it wrote is a file somebody can post",
  async run(ctx: QcContext): Promise<CheckResult> {
    if (!ctx.organizationId) return nothing();
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: s.creativeAssets.id,
        packId: s.creativeAssets.packId,
        kind: s.creativeAssets.kind,
        index: s.creativeAssets.index,
        storageKey: s.creativeAssets.storageKey,
        format: s.creativePacks.format,
        name: s.creativePacks.name,
      })
      .from(s.creativeAssets)
      .innerJoin(s.creativePacks, eq(s.creativePacks.id, s.creativeAssets.packId))
      .where(
        and(
          eq(s.creativeAssets.organizationId, ctx.organizationId),
          eq(s.creativeAssets.status, "READY"),
          isNotNull(s.creativeAssets.storageKey),
          gte(s.creativeAssets.createdAt, since),
        ),
      )
      .orderBy(desc(s.creativeAssets.createdAt))
      .limit(200);
    if (!rows.length) return nothing();

    const stills = rows.filter((row) => row.kind === "FRAME" || row.kind === "COVER").slice(0, STILL_LIMIT);
    const videos = rows.filter((row) => row.kind === "VIDEO").slice(0, VIDEO_LIMIT);
    const results: CheckResult[] = [];

    // ── stills ─────────────────────────────────────────────────────────────────────────────
    if (stills.length) {
      let broken = 0;
      let wrongSize = 0;
      const detail: { pack: string; frame: number; why: string }[] = [];
      for (const still of stills) {
        const bytes = await ctx.storage.get(still.storageKey!).catch(() => null);
        if (!bytes) continue;
        const wanted = FORMATS[still.format as CreativeFormat];
        try {
          // A full decode rather than a header read: a truncated PNG has a perfectly good header.
          const { info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
          // A cover is a contact sheet of the set, not something posted at the format's size.
          if (still.kind === "FRAME" && wanted && (info.width !== wanted.width || info.height !== wanted.height)) {
            wrongSize += 1;
            detail.push({ pack: still.name, frame: still.index + 1, why: `${info.width}×${info.height}, not ${wanted.width}×${wanted.height}` });
          }
        } catch (err) {
          broken += 1;
          detail.push({ pack: still.name, frame: still.index + 1, why: err instanceof Error ? err.message.slice(0, 120) : "it will not decode" });
        }
      }
      results.push(
        compare({
          spec: FRAME_DECODES,
          actual: broken,
          location: { entityType: "workspace", entityId: ctx.organizationId, field: "stills" },
          message: broken ? `${broken} of ${stills.length} finished stills will not decode.` : `All ${stills.length} finished stills decode.`,
          evidence: { checked: stills.length, detail: detail.slice(0, 10) },
        }),
        compare({
          spec: FRAME_CANVAS,
          actual: wrongSize,
          location: { entityType: "workspace", entityId: ctx.organizationId, field: "stills" },
          message: wrongSize ? `${wrongSize} still(s) are not the size their format is posted at.` : `Every still is the size its format is posted at.`,
          evidence: { checked: stills.length, detail: detail.slice(0, 10) },
        }),
      );
    }

    // ── videos ─────────────────────────────────────────────────────────────────────────────
    for (const video of videos) {
      const bytes = await ctx.storage.get(video.storageKey!).catch(() => null);
      if (!bytes) continue;
      const wanted = FORMATS[video.format as CreativeFormat];
      const probe = await probeVideo(bytes);
      const at = { entityType: "output" as const, entityId: video.packId, entityLabel: video.name, field: "video" };

      results.push(
        compare({
          spec: VIDEO_DECODES,
          actual: probe.decodeErrors.length,
          location: at,
          message: probe.decodeErrors.length
            ? `“${video.name}” does not decode cleanly: ${probe.decodeErrors[0]}`
            : `“${video.name}” decodes from first frame to last.`,
          evidence: { errors: probe.decodeErrors.slice(0, 5) },
        }),
      );
      if (probe.width && probe.height && wanted) {
        results.push(
          assertThat({
            spec: VIDEO_CANVAS,
            holds: probe.width === wanted.width && probe.height === wanted.height,
            location: at,
            message: `“${video.name}” is ${probe.width}×${probe.height}; ${wanted.name} is posted at ${wanted.width}×${wanted.height}.`,
            expected: `${wanted.width}×${wanted.height}`,
            actual: `${probe.width}×${probe.height}`,
          }),
        );
      }
      if (probe.seconds !== null && wanted?.maxSeconds) {
        const over = Math.max(0, probe.seconds - wanted.maxSeconds);
        results.push(
          compare({
            spec: VIDEO_DURATION,
            actual: over,
            location: at,
            message: over
              ? `“${video.name}” runs ${probe.seconds.toFixed(1)}s; ${wanted.platforms.join(" and ")} take ${wanted.maxSeconds}s.`
              : `“${video.name}” runs ${probe.seconds.toFixed(1)}s, inside the ${wanted.maxSeconds}s the platform takes.`,
            expectedText: `≤ ${wanted.maxSeconds} s`,
            evidence: { seconds: Math.round(probe.seconds * 10) / 10, maximum: wanted.maxSeconds },
          }),
        );
      }
    }

    return results.length ? merge(...results) : nothing();
  },
};

type Probe = { width: number | null; height: number | null; seconds: number | null; decodeErrors: string[] };

/**
 * Decode the whole file and see what comes out.
 *
 * `-f null -` throws the pixels away and keeps the complaints, which is the only way to tell a
 * video that plays from a video whose header says it should. A container that parses and fails at
 * frame 300 is exactly the output a provider reports as a success.
 */
async function probeVideo(bytes: Buffer): Promise<Probe> {
  const path = join(await fs.mkdtemp(join(tmpdir(), "qc-video-")), "clip.mp4");
  try {
    await fs.writeFile(path, bytes);
    const { stderr } = await ffmpeg(["-hide_banner", "-i", path, "-f", "null", "-"]);
    const size = /Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(stderr);
    const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    const decodeErrors = stderr
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\[?(error|.*Error|.*Invalid data|.*corrupt)/i.test(line) && !line.startsWith("Input #"))
      .slice(0, 20);
    return {
      width: size ? Number(size[1]) : null,
      height: size ? Number(size[2]) : null,
      seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
      decodeErrors,
    };
  } finally {
    await fs.rm(path, { force: true }).catch(() => {});
  }
}

function ffmpeg(args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve) => {
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(ffmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => resolve({ stderr: `error: ${err.message}` }));
      child.on("close", () => resolve({ stderr }));
    });
  });
}
