/**
 * Pure constants and formatting helpers of the media library. This module has no server imports so
 * client components can use it; `library.ts` re-exports everything for server code.
 */

export const MEDIA_KINDS = ["photo", "logo", "screenshot", "diagram", "chart", "document"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const KIND_LABELS: Record<MediaKind, string> = {
  photo: "Photo",
  logo: "Logo",
  screenshot: "Screenshot",
  diagram: "Diagram",
  chart: "Chart",
  document: "Document",
};

export const STORY_MEDIA_ROLES = [
  "hero",
  "gallery",
  "logo",
  "diagram",
  "screenshot",
  "portrait",
  "cover",
] as const;
export type StoryMediaRole = (typeof STORY_MEDIA_ROLES)[number];

export const ROLE_LABELS: Record<StoryMediaRole, string> = {
  hero: "Hero",
  gallery: "Gallery",
  logo: "Logo",
  diagram: "Diagram",
  screenshot: "Screenshot",
  portrait: "Portrait",
  cover: "Cover",
};

export const RIGHTS_STATUSES = ["GREEN", "YELLOW", "RED"] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

/** Below this score an asset is flagged "low quality" everywhere in the library. */
export const LOW_QUALITY_THRESHOLD = 60;
/** Minimum width (px) for an asset to count as print-ready (together with GREEN rights). */
export const PRINT_READY_MIN_WIDTH = 1400;

export const MEDIA_SORTS = ["newest", "oldest", "quality", "size", "name"] as const;
export type MediaSort = (typeof MEDIA_SORTS)[number];

export const QUALITY_FLAG_EXPLANATIONS: Record<string, string> = {
  VERY_LOW_RESOLUTION: "Longest side under 800 px — unusable in print beyond a thumbnail.",
  LOW_RESOLUTION: "Longest side under 1400 px — fine for a small inline image, not for a hero.",
  HEAVY_COMPRESSION: "Very few bytes per pixel — JPEG artefacts will show on paper.",
  LOW_CONTRAST: "Flat tonal range — the photo may look washed out in print.",
  EXTREME_ASPECT_RATIO: "Very wide or very tall — only fits banner or strip slots.",
  EXACT_DUPLICATE: "Byte-for-byte identical to another asset of this edition.",
  NEAR_DUPLICATE: "Perceptually almost identical to another asset (same shot or a re-export).",
  SIMILAR_IMAGE: "Visually similar to another asset (same scene, different frame).",
};

export function explainQualityFlag(flag: string) {
  return QUALITY_FLAG_EXPLANATIONS[flag] ?? flag.toLowerCase().replace(/_/g, " ");
}

export function flagLabel(flag: string) {
  return flag
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function formatBytes(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function formatDimensions(
  width: number | null | undefined,
  height: number | null | undefined,
) {
  return width && height ? `${width}×${height}` : "—";
}

/** Human aspect label ("3:2", "16:9", or "1.37:1" when the ratio is not a small fraction). */
export function aspectLabel(width: number, height: number) {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height) || 1;
  const w = width / g;
  const h = height / g;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}:1`;
}

/** Tailwind classes for the rights signal (dot / stripe), the most important thing on a card. */
export const RIGHTS_DOT_CLASS: Record<RightsStatus, string> = {
  GREEN: "bg-success",
  YELLOW: "bg-warning",
  RED: "bg-destructive",
};

export function qualityTone(
  score: number | null | undefined,
): "success" | "warning" | "destructive" | "muted" {
  if (score === null || score === undefined) return "muted";
  if (score >= 80) return "success";
  if (score >= LOW_QUALITY_THRESHOLD) return "warning";
  return "destructive";
}

/** Labels for audit actions written by the media services. */
export const MEDIA_AUDIT_LABELS: Record<string, string> = {
  "media.upload": "Uploaded",
  "media.update": "Metadata edited",
  "media.archive": "Archived",
  "media.restore": "Restored",
  "media.duplicate.mark": "Marked as duplicate",
  "media.duplicate.clear": "Duplicate flag cleared",
  "media.consent.record": "Image rights consent recorded",
  "media.consent.decline": "Image rights consent declined",
  "media.attach": "Attached to a story",
  "media.detach": "Detached from a story",
  "media.role": "Story role changed",
  "media.crop": "Crop generated",
  "media.crop.clear": "Crop removed",
  "decision.rights_green": "Rights approved",
  "decision.rights_yellow": "Rights set to unclear",
  "decision.rights_red": "Rights blocked (do not publish)",
};
