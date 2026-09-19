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
export const QC_SPEC_VERSION = "2026.09.2";

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
  method: "sourcePixels ÷ printed size in inches, using the placed box from the layout rather than the file's own dimensions, compared with the minimum the active output profile asks for.",
  unit: "ppi",
  // The numbers come from the output profile; what is fixed here is that falling short of the
  // profile's floor is a failure and coming within its warning band is a warning.
  target: "at least the profile's minimum resolution",
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

export const IMAGE_CROP_LOSS = m({
  id: "image.crop.loss",
  title: "How much of a picture the page throws away",
  method: "The source aspect ratio is compared with the aspect of the box the template gives it, and the fraction of the frame lost to the crop is 1 − min(a,c) ÷ max(a,c). Every picture in the print stylesheet is object-fit: cover or contain, so nothing is ever stretched — what varies is how much is cut off.",
  unit: "ratio",
  target: "no more than a third of the frame lost",
  // A warning, and deliberately not a failure. A tight crop is an art-direction decision and an art
  // director is allowed to make it; what they are not allowed to do is make it by accident. This
  // rule started life as "aspect distortion" at FAIL, which measured a defect this renderer cannot
  // produce — it crops, it never stretches — and so blocked publication on every cover it saw.
  warningThreshold: 0.35,
  severity: "WARNING",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "A portrait in a landscape box loses the top of a head before it loses anything else.",
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
  title: "Rights nobody has got round to clearing",
  method: "Every placed asset is checked for a YELLOW (unresolved) rights status, which in this product is what a picture has until somebody decides.",
  unit: "count",
  /*
   * A warning, because YELLOW is where every picture in this product starts.
   *
   * Refused rights are a different rule and a hard one: rights.cleared is HARD_FAIL and nothing
   * gets past it. This is the other case — a picture nobody has got round to deciding about — and
   * making it block a publish means blocking every publish, since a library's default state is
   * undecided. A gate that fires on the default state of everything is a gate that gets switched
   * off, and then the refused-rights rule goes off with it.
   */
  warningThreshold: 0,
  severity: "WARNING",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "Refused rights block absolutely (rights.cleared); undecided rights are worth knowing about.",
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

export const TYPE_ORPHANS = m({
  id: "layout.type.orphans",
  title: "No first line is left alone at the foot of a column",
  method: "The in-page measurement counts, per flow, paragraphs whose first fragment across a column break is less than 1.6 line-heights tall.",
  unit: "count",
  failureThreshold: 3,
  warningThreshold: 0,
  severity: "WARNING",
  repair: null,
  origin: "INDUSTRY_STANDARD",
  reference: "Standard composition practice: a paragraph's first line does not stand alone at a column foot.",
});

export const TYPE_WIDOWS = m({
  id: "layout.type.widows",
  title: "No last line is left alone at the head of a column",
  method: "The in-page measurement counts, per flow, paragraphs whose last fragment across a column break is less than 1.6 line-heights tall.",
  unit: "count",
  failureThreshold: 3,
  warningThreshold: 0,
  severity: "WARNING",
  repair: null,
  origin: "INDUSTRY_STANDARD",
  reference: "Standard composition practice: a paragraph's last line does not stand alone at a column head.",
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
  title: "Nothing important is set inside the printer's safe margin",
  method: "The page insets the renderer declares in the stylesheet it embeds are read out of the artefact and compared with the safe margin the active output profile asks for. The threshold is the profile's, not this file's: a printer who asks for 8mm is not wrong.",
  unit: "mm",
  target: "at least the profile's safe margin",
  severity: "FAIL",
  repair: null,
  origin: "OUTPUT_PROVIDER_REQUIREMENT",
  reference: "Trim tolerance on a commercial press is typically 1–2mm either way, so type set to the trim can come back cut.",
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

/* ── Brand colour ─────────────────────────────────────────────────────────────────────────── */

export const BRAND_COLOUR_DECLARED = m({
  id: "brand.colour.declared",
  title: "The brand every renderer compiles from is the brand the workspace declared",
  method:
    "CIEDE2000 between each colour role the workspace typed into its settings and the same role in the active brand system, which is what the magazine, the email and every creative frame are actually drawn from. The worst role is the measurement.",
  unit: "deltaE",
  target: "≤ 2 ΔE00 from the declared colour",
  warningThreshold: 2,
  failureThreshold: 5,
  severity: "FAIL",
  // No repair. Both numbers were typed by a person on purpose — one in Settings, one in the brand
  // editor — and software choosing between them would silently rebrand somebody. The finding names
  // both colours and their distance; which one is the brand is not arithmetic.
  repair: null,
  origin: "INDUSTRY_STANDARD",
  reference: "CIE 142-2001 (CIEDE2000). ΔE00 ≤ 2 is the commercial 'same colour' tolerance; over 5 is a different colour.",
});

export const BRAND_COLOUR_RENDERED = m({
  id: "brand.colour.rendered",
  title: "A brand graphic is painted the colour its spec asked for",
  method:
    "For each deterministically drawn frame, CIEDE2000 between the fill its render spec names and the pixel actually in the file at that fill's centre — sampled only where no picture and no type covers it. Photographs are never measured.",
  unit: "deltaE",
  target: "≤ 2 ΔE00 from the specified fill",
  warningThreshold: 2,
  failureThreshold: 5,
  severity: "FAIL",
  // No repair. The renderer is deterministic: the same spec produces the same bytes, so re-running
  // it would measure the same colour again. A frame that came out the wrong colour is a defect in
  // the renderer, and a repair loop that cannot change the input cannot fix it.
  repair: null,
  origin: "INDUSTRY_STANDARD",
  reference: "CIE 142-2001 (CIEDE2000).",
});

/* ── Video and fixed-image outputs ────────────────────────────────────────────────────────── */

export const VIDEO_DECODES = m({
  id: "creative.video.decodes",
  title: "A video file that was written is a video file that plays",
  method: "The encoded file is decoded end to end and every decoder error is counted. A file nothing can read is not an output, whatever the encoder reported.",
  unit: "count",
  target: 0,
  failureThreshold: 0,
  severity: "CRITICAL_FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const VIDEO_CANVAS = m({
  id: "creative.video.canvas",
  title: "The cut is the size the platform will play",
  method: "The encoded stream's pixel dimensions are compared with the format's canvas. A Reel that is not 1080×1920 is letterboxed or cropped by the platform, not by anybody who chose it.",
  unit: "boolean",
  target: "the format's canvas",
  severity: "FAIL",
  repair: null,
  origin: "OUTPUT_PROVIDER_REQUIREMENT",
});

export const VIDEO_DURATION = m({
  id: "creative.video.duration",
  title: "The cut is inside the length the platform accepts",
  method: "The encoded duration in seconds against the format's published maximum, measured as seconds over it. Past that length the upload is refused or silently truncated.",
  unit: "seconds",
  target: "the format's maximum length",
  failureThreshold: 0,
  severity: "FAIL",
  repair: null,
  origin: "OUTPUT_PROVIDER_REQUIREMENT",
});

export const FRAME_DECODES = m({
  id: "creative.frame.decodes",
  title: "A frame that was written is a frame that opens",
  method: "Every still is fully decoded rather than read for its header: truncated files, zero dimensions and unreadable data are caught before somebody posts one.",
  unit: "count",
  target: 0,
  failureThreshold: 0,
  severity: "CRITICAL_FAIL",
  repair: null,
  origin: "BRIEFLY_HOUSE_STANDARD",
});

export const FRAME_CANVAS = m({
  id: "creative.frame.canvas",
  title: "A still is the size its format is posted at",
  method: "Each still's pixel dimensions against the format's canvas. A frame at the wrong size is resampled by the platform, which is where soft type comes from.",
  unit: "count",
  target: 0,
  failureThreshold: 0,
  severity: "FAIL",
  repair: null,
  origin: "OUTPUT_PROVIDER_REQUIREMENT",
});

/* ── Delivery reconciliation ──────────────────────────────────────────────────────────────── */

export const DELIVERY_RECONCILES = m({
  id: "delivery.reconciles",
  title: "The delivery log says what the provider said",
  method:
    "Every event the provider sent about a message is replayed through the same rules the webhook handler applies, and the state that replay arrives at is compared with the state the log holds. Counts the messages the two disagree about.",
  unit: "count",
  target: 0,
  failureThreshold: 0,
  severity: "FAIL",
  repair: "apply-provider-state",
  origin: "BRIEFLY_HOUSE_STANDARD",
  reference: "The provider is authoritative for what happened to a message; Briefly's column is a cache of it.",
});

export const DELIVERY_UNCONFIRMED = m({
  id: "delivery.unconfirmed",
  title: "A message sent through the provider is a message the provider reported on",
  method:
    "Messages sent through the provider more than a day ago for which no event of any kind was ever received. Counted only for providers that report back, so mail sent through a mailbox is never called unconfirmed.",
  unit: "count",
  target: 0,
  warningThreshold: 0,
  severity: "WARNING",
  // No repair. Nothing arrived because nothing is wired up or the endpoint is refusing; both are
  // settings a person changes, and no amount of measuring will deliver the events that were lost.
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
  IMAGE_CROP_LOSS,
  RIGHTS_CLEARED,
  RIGHTS_RESOLVED,
  TEXT_OVERFLOW,
  PAGE_BLANK,
  PAGE_COUNT_MATCHES,
  PAGE_FIT_RATIO,
  PAGE_UNDERFILLED,
  TYPE_ORPHANS,
  TYPE_WIDOWS,
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
  BRAND_COLOUR_DECLARED,
  BRAND_COLOUR_RENDERED,
  VIDEO_DECODES,
  VIDEO_CANVAS,
  VIDEO_DURATION,
  FRAME_DECODES,
  FRAME_CANVAS,
  DELIVERY_RECONCILES,
  DELIVERY_UNCONFIRMED,
];

export const metricById = new Map(ALL_METRICS.map((metric) => [metric.id, metric]));
