import type { MetricSpec } from "./types";

/**
 * Every rule Briefly measures against, in one place, with a version.
 *
 * Thresholds live here rather than in the checks so that two things are possible: reading the whole
 * standard without reading the code, and saying which standard an issue was judged against months
 * later. Every edition and export records `QC_SPEC_VERSION`, so a run from March can be explained
 * even after the numbers move.
 *
 * Every threshold carries its origin, because the most common mistake in preflight is quoting a
 * house preference as though it were a law. 300 PPI is a common commercial print requirement, not
 * physics; a printer who asks for 240 is not wrong, and that is why the number comes from the
 * output profile rather than from this file. What lives here is the *rule* — "the effective
 * resolution must reach the profile's minimum" — and the severity of missing it.
 */

/** Bump on any change to a threshold, a severity or the set of rules. */
export const QC_SPEC_VERSION = "2026.09.1";

const m = (spec: MetricSpec): MetricSpec => spec;

/* ── Storage and asset integrity ──────────────────────────────────────────────────────────── */

export const STORAGE_OBJECT_PRESENT = m({
  id: "storage.object.present",
  title: "Every file the issue references exists in storage",
  method: "Each storage key on the document's media and publication assets is looked up in the configured bucket.",
  unit: "boolean",
  target: "present",
  severity: "HARD_FAIL",
  repair: "regenerate-variant",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const STORAGE_DURABLE = m({
  id: "storage.durable",
  title: "Durable storage is object storage",
  method: "The resolved storage provider is checked against the environment it is running in.",
  unit: "boolean",
  target: "object storage in production",
  severity: "WARNING",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const ASSET_DECODES = m({
  id: "asset.decodes",
  title: "Every placed image decodes",
  method: "The bytes of each placed image are decoded and their dimensions read.",
  unit: "boolean",
  target: "decodes",
  severity: "HARD_FAIL",
  repair: "drop-ineligible-asset",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

/* ── Imagery ──────────────────────────────────────────────────────────────────────────────── */

export const IMAGE_EFFECTIVE_PPI = m({
  id: "image.effective.ppi",
  title: "Effective resolution at the size it is printed",
  method: "sourcePixels ÷ printed size in inches, using the placed box from the layout rather than the file's own dimensions.",
  unit: "ppi",
  // The numbers come from the output profile; what is fixed here is that falling short of the
  // profile's floor is a failure and coming within its warning band is a warning.
  severity: "FAIL",
  repair: "swap-to-valid-asset",
  origin: "OUTPUT_PROVIDER_REQUIREMENT",
  reference: "Per-profile minimumPpi; 300 is a common commercial requirement, not a universal one.",
});

export const IMAGE_ELIGIBLE = m({
  id: "image.eligible",
  title: "Nothing is placed as a photograph that is not one",
  method: "Each picture drawn in the document, or attached to one of its stories in a picture slot, is passed through the shared page-eligibility rule minus its rights clause: no logo, nothing archived, nothing unusably small or oddly shaped. Rights are measured separately under rights.cleared.",
  unit: "boolean",
  target: "eligible",
  severity: "HARD_FAIL",
  repair: "drop-ineligible-asset",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const IMAGE_ASPECT_DISTORTION = m({
  id: "image.aspect.distortion",
  title: "An image is not stretched",
  method: "|container aspect ÷ source aspect − 1|, for images placed without a crop.",
  unit: "ratio",
  warningThreshold: 0.02,
  failureThreshold: 0.1,
  severity: "FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "2% is invisible; 10% is a face nobody recognises.",
});

/* ── Rights ───────────────────────────────────────────────────────────────────────────────── */

export const RIGHTS_CLEARED = m({
  id: "rights.cleared",
  title: "Nothing goes out whose rights are refused",
  method: "Every media asset placed in the document, or attached to one of its stories in a picture slot, is checked for a RED rights status.",
  unit: "boolean",
  target: "GREEN or YELLOW",
  severity: "HARD_FAIL",
  // Deliberately no repair. Software may take a logo off a story — that is a category error with one
  // right answer — but taking a *photograph* out of an issue to clear a rights gate is an editorial
  // act, and doing it automatically would mean the gate went green because the picture disappeared
  // rather than because anybody cleared it. A person clears the rights or removes the picture.
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const RIGHTS_RESOLVED = m({
  id: "rights.resolved",
  title: "Nothing is published with rights still unresolved",
  method: "Every placed asset is checked for a YELLOW (unresolved) rights status.",
  unit: "count",
  failureThreshold: 0,
  severity: "FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "Blocks a publish, not a draft: a draft is how a newsroom finds out what to clear.",
});

/* ── Geometry and typography ──────────────────────────────────────────────────────────────── */

export const TEXT_OVERFLOW = m({
  id: "layout.text.overflow",
  title: "No text runs past the box it was given",
  method: "The paginator measures every flow against its frame and reports what still does not fit after copyfitting.",
  unit: "count",
  failureThreshold: 0,
  severity: "HARD_FAIL",
  repair: "reflow-overflow",
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "Two pixels is a failure. There is no tolerance band for clipped words.",
});

export const PAGE_BLANK = m({
  id: "layout.page.blank",
  title: "No page is blank",
  method: "Pages whose measured content area is empty after pagination.",
  unit: "count",
  failureThreshold: 0,
  severity: "HARD_FAIL",
  repair: "reflow-overflow",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const PAGE_COUNT_MATCHES = m({
  id: "layout.pagecount.matches",
  title: "The rendered page count is the planned page count",
  method: "Pages in the rendered artefact compared with pages in the final document.",
  unit: "count",
  failureThreshold: 0,
  severity: "CRITICAL_FAIL",
  repair: "rerender-output",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const PAGE_FIT_RATIO = m({
  id: "layout.page.fit",
  title: "Content fits inside the page's usable area",
  method: "Measured content height ÷ usable frame height, per page.",
  unit: "ratio",
  warningThreshold: 0.98,
  failureThreshold: 1,
  severity: "FAIL",
  repair: "reflow-overflow",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const PAGE_UNDERFILLED = m({
  id: "layout.page.underfilled",
  title: "A page is not nearly empty",
  method: "Occupied area ÷ usable area, per page.",
  unit: "ratio",
  warningThreshold: 0.45,
  failureThreshold: 0.2,
  severity: "WARNING",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "A warning, not a failure: an art director decides whether air is a mistake. Measured so the decision is informed.",
});

export const IMAGE_RENDER_FAILED = m({
  id: "layout.image.failed",
  title: "Every image on a page actually rendered",
  method: "Images the renderer could not load, reported by the layout pass.",
  unit: "count",
  failureThreshold: 0,
  severity: "HARD_FAIL",
  repair: "regenerate-variant",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

/* ── PDF and print ────────────────────────────────────────────────────────────────────────── */

export const PDF_PARSES = m({
  id: "pdf.parses",
  title: "The PDF is a readable PDF",
  method: "The artefact is fully parsed and every page object is read.",
  unit: "boolean",
  target: "parses",
  severity: "CRITICAL_FAIL",
  repair: "rerender-output",
  origin: "INDUSTRY_STANDARD",
});

export const PDF_PAGE_SIZE = m({
  id: "pdf.page.size",
  title: "Every page is the size the profile asks for",
  method: "Each page's MediaBox is compared with the profile's trim plus bleed, in millimetres.",
  unit: "mm",
  failureThreshold: 0.5,
  severity: "HARD_FAIL",
  repair: "rerender-output",
  origin: "OUTPUT_PROVIDER_REQUIREMENT",
  reference: "Half a millimetre is the tolerance of a trimmer, not a preference.",
});

export const PDF_FONTS_EMBEDDED = m({
  id: "pdf.fonts.embedded",
  title: "Every font is embedded",
  method: "Font resources are read from each page and checked for an embedded font file.",
  unit: "count",
  failureThreshold: 0,
  severity: "HARD_FAIL",
  repair: "rerender-output",
  origin: "INDUSTRY_STANDARD",
  reference: "PDF/X requires embedding; a substituted font reflows the page on somebody else's machine.",
});

export const PDF_METADATA = m({
  id: "pdf.metadata",
  title: "The file says which issue it is",
  method: "Title, author and subject are read from the document information dictionary.",
  unit: "boolean",
  target: "present",
  severity: "WARNING",
  repair: "rerender-output",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const PRINT_BLEED = m({
  id: "print.bleed",
  title: "The document carries the bleed the printer asks for",
  method: "(document size − trim size) ÷ 2 per edge, compared with the profile's bleed.",
  unit: "mm",
  failureThreshold: 0.5,
  severity: "HARD_FAIL",
  repair: "rerender-output",
  origin: "OUTPUT_PROVIDER_REQUIREMENT",
});

export const PRINT_SAFE_MARGIN = m({
  id: "print.safe.margin",
  title: "Nothing important sits inside the trim edge",
  method: "The smallest distance from any text frame to the trim edge, compared with the profile's safe margin.",
  unit: "mm",
  failureThreshold: 0,
  severity: "FAIL",
  repair: null,
  origin: "OUTPUT_PROVIDER_REQUIREMENT",
});

/* ── Email ────────────────────────────────────────────────────────────────────────────────── */

export const EMAIL_IMAGES_RESOLVE = m({
  id: "email.images.resolve",
  title: "Every picture in the email has bytes behind it",
  method: "Each <img> source is resolved: data URIs are decoded, storage keys are looked up in the bucket.",
  unit: "count",
  failureThreshold: 0,
  severity: "HARD_FAIL",
  repair: "resign-asset-url",
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const EMAIL_LINKS_VALID = m({
  id: "email.links.valid",
  title: "Every link is a link somebody can follow",
  method: "Every href is parsed: empty, relative, localhost and staging hosts are counted as broken.",
  unit: "count",
  failureThreshold: 0,
  severity: "FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const EMAIL_UNSUBSCRIBE = m({
  id: "email.unsubscribe",
  title: "Every message carries its own unsubscribe link",
  method: "The rendered HTML and text body are searched for a per-recipient unsubscribe URL.",
  unit: "boolean",
  target: "present",
  severity: "HARD_FAIL",
  repair: null,
  origin: "INDUSTRY_STANDARD",
  reference: "Bulk mail without a working opt-out is a compliance failure before it is a quality one.",
});

export const EMAIL_ALT_TEXT = m({
  id: "email.alt.text",
  title: "Pictures have alternative text",
  method: "Images in the rendered HTML without a non-empty alt attribute.",
  unit: "count",
  warningThreshold: 0,
  severity: "WARNING",
  repair: null,
  origin: "INDUSTRY_STANDARD",
  reference: "WCAG 1.1.1. A warning in email, where a decorative rule is legitimately empty.",
});

export const EMAIL_WIDTH = m({
  id: "email.width",
  title: "The email does not scroll sideways on a phone",
  method: "The widest declared width in the rendered HTML compared with the profile's viewport.",
  unit: "px",
  failureThreshold: 0,
  severity: "FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

/* ── Web ──────────────────────────────────────────────────────────────────────────────────── */

export const WEB_METADATA = m({
  id: "web.metadata",
  title: "A published page says what it is",
  method: "Title, description and canonical URL are read from the rendered page's head.",
  unit: "boolean",
  target: "present",
  severity: "WARNING",
  repair: null,
  origin: "INDUSTRY_STANDARD",
});

export const WEB_NOINDEX_UNPUBLISHED = m({
  id: "web.noindex.unpublished",
  title: "An unpublished issue is never indexed",
  method: "The robots directive of an edition whose web output is not PUBLISHED.",
  unit: "boolean",
  target: "noindex",
  severity: "FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

/* ── Facts across outputs ─────────────────────────────────────────────────────────────────── */

export const FACT_CONSISTENCY = m({
  id: "facts.consistent",
  title: "A number means the same thing in every output",
  method: "Money, percentages and dates are extracted from each article and from that article's own teaser in the email, normalised, and compared. Only an article's own teaser is compared with it, never the message as a whole.",
  unit: "count",
  failureThreshold: 0,
  // FAIL rather than HARD_FAIL: a contradiction between outputs is a defect of the issue, not of
  // the file. It must stop a final or published version, and it must not stop the newsroom seeing
  // the proof in which it is visible.
  severity: "FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "Copy may shorten between outputs. Facts may not move.",
});

/* ── Revisions and staleness ──────────────────────────────────────────────────────────────── */

export const REVISION_SCOPE = m({
  id: "revision.scope",
  title: "An exact cut changes exactly what it said it would",
  method: "Tokens changed outside the targeted passage, after normalising whitespace and quote shapes.",
  unit: "count",
  failureThreshold: 0,
  severity: "HARD_FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const OUTPUT_STALE = m({
  id: "output.stale",
  title: "A frozen artefact matches the issue it was made from",
  method: "The content, layout and asset hashes stored with the artefact are recomputed and compared.",
  unit: "hash",
  target: "identical",
  severity: "WARNING",
  repair: "rerender-output",
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "A warning rather than a failure: a stale PDF is honest history until somebody republishes.",
});

/* ── Analytics and providers ──────────────────────────────────────────────────────────────── */

export const ANALYTICS_RECONCILES = m({
  id: "analytics.reconciles",
  title: "The dashboard figure equals the rows it claims to count",
  method: "Each delivery metric is recomputed from the raw log by its documented formula and compared with the read model.",
  unit: "count",
  failureThreshold: 0,
  severity: "FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const ANALYTICS_TENANCY = m({
  id: "analytics.tenancy",
  title: "No customer figure counts another customer's rows",
  method: "Each workspace's delivery total is recomputed directly and compared with the scoped reader's answer.",
  unit: "count",
  failureThreshold: 0,
  severity: "CRITICAL_FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const PROVIDER_OUTPUT_CHECKED = m({
  id: "provider.output.checked",
  title: "A provider reporting success is not the same as a usable output",
  method: "Jobs marked SUCCEEDED whose artefact is missing, empty or failed its own checks.",
  unit: "count",
  failureThreshold: 0,
  severity: "FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

/** Every rule, for the console and for anything that wants to print the standard. */
export const ALL_METRICS: readonly MetricSpec[] = [
  STORAGE_OBJECT_PRESENT,
  STORAGE_DURABLE,
  ASSET_DECODES,
  IMAGE_EFFECTIVE_PPI,
  IMAGE_ELIGIBLE,
  IMAGE_ASPECT_DISTORTION,
  RIGHTS_CLEARED,
  RIGHTS_RESOLVED,
  TEXT_OVERFLOW,
  PAGE_BLANK,
  PAGE_COUNT_MATCHES,
  PAGE_FIT_RATIO,
  PAGE_UNDERFILLED,
  IMAGE_RENDER_FAILED,
  PDF_PARSES,
  PDF_PAGE_SIZE,
  PDF_FONTS_EMBEDDED,
  PDF_METADATA,
  PRINT_BLEED,
  PRINT_SAFE_MARGIN,
  EMAIL_IMAGES_RESOLVE,
  EMAIL_LINKS_VALID,
  EMAIL_UNSUBSCRIBE,
  EMAIL_ALT_TEXT,
  EMAIL_WIDTH,
  WEB_METADATA,
  WEB_NOINDEX_UNPUBLISHED,
  FACT_CONSISTENCY,
  REVISION_SCOPE,
  OUTPUT_STALE,
  ANALYTICS_RECONCILES,
  ANALYTICS_TENANCY,
  PROVIDER_OUTPUT_CHECKED,
];

export const metricById = new Map(ALL_METRICS.map((metric) => [metric.id, metric]));
