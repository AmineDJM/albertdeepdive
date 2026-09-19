# The publication quality-control engine

Status: **specified, not built.** This document is the agreed target. The tasks that implement it
are tracked separately; nothing here should be read as describing code that exists today.

## The rule

```
MEASURE → COMPARE → FAIL → REPAIR → REMEASURE
```

Briefly is a publishing operating system, so its quality system has to behave like professional
newsroom QA plus design preflight plus print preflight plus email QA plus web QA plus media-rights
QA plus delivery reconciliation — not like asking a model whether an issue looks good.

AI judgement is allowed for subjective editorial and creative quality. It may **not** replace an
objective check. An art director cannot approve a 12px overflow, a forbidden image, a wrong number,
a missing font or a corrupt PDF: those are failures whatever anybody thinks of the page.

Every objectively measurable characteristic ends with machine-readable evidence saying why it
passed.

---

## 1. Versioned QC specifications

Rules live in data, not scattered through the code:

```
qc/
  editorial.json  layout.json  typography.json  imagery.json
  print.json      pdf.json     email.json       web.json
  video.json      rights.json  analytics.json
```

Each rule carries `metricId`, `measurementMethod`, `unit`, `target`, `warningThreshold`,
`failureThreshold`, `severity`, a repair strategy, a threshold origin and a standard reference where
one exists. Origins are `INDUSTRY_STANDARD`, `OUTPUT_PROVIDER_REQUIREMENT` or
`BRIEFLY_HOUSE_STANDARD` — so nobody has to guess whether 300 PPI is a law of physics or our
house rule. Every edition and export stores the `qcSpecificationVersion` it was judged against.

## 2. Finished generating is not ready

```
DRAFT → GENERATING → PREFLIGHT → REPAIRING → PREFLIGHT_FAILED → READY → PUBLISHED
```

A frozen artefact (PDF, print, video) becomes READY only after its required QC profile passes.

## 3–6. Content integrity

- Structured source references per story: submission, URL/document, contributor, original text,
  edited text, generation history. Accidental content loss is detected, not hoped against.
- Deterministic transformations compare before, after and the intended operation. `remove_passage`
  must prove the passage existed, that exactly it went, and that nothing outside the targeted region
  changed beyond known formatting normalisation. The diff is stored.
- Every revision has a machine-readable diff: words added and removed, stories, pages, images,
  layouts changed, outputs invalidated. For exact cuts, `unexpectedChangedTokens` outside the target
  must be 0 or the revision fails.
- Structured factual values appearing more than once are cross-checked: dates, prices, percentages,
  counts, revenue, times, names, titles. Source says €2.4M, graphic says €24M → `CRITICAL_FAIL`.
- Story length is measured against editorial intent (`targetWords` vs `actualWords`, house tolerance
  ±10% unless an exact constraint was asked for). 760 words never silently answers a 400-word brief.

## 7–10. Geometry

Headlines are measured, not consulted about: bounding box, line count, font size, available width
and height, overflow pixels. Unintended overflow must be 0px; the repairs are reflow, resize within
brand limits, an authorised rewrite, or a different layout — then remeasure.

Every rendered text block reports font, weight, size, line height, tracking, line count, bounding
box, contrast, alignment and overflow, and the engine detects clipping, collisions, unexpected
wrapping, font fallback and missing glyphs. No clipped text ships.

Layouts know their page dimensions, margins, columns, gutters and safe bounds; components know x, y,
width and height. Page intersection, safe-area containment, overlap, gutter preservation and
minimum spacing are arithmetic. `minX/maxX/minY/maxY` are compared against composition bounds;
lateral bleed must be modelled explicitly rather than inferred, and vertical overflow stays
prohibited unless a layout declares otherwise.

## 11–17. Imagery, rights and brand

`pageEligible(asset)` and `photoEligible(asset)` stay as two questions, with measurable criteria:
type, rights, archive state, dimensions, aspect ratio, resolution, transparency, file integrity.
Effective PPI is computed after placement (`sourcePixels / printedInches`) against the output
profile's target rather than one universal number. Crops are measured against a focal point and
flagged when they remove a face, a subject, a logo or critical text. Every selected image is fully
decoded: corrupt files, zero dimensions, bad alpha, unsupported colour profiles and orientation
metadata problems are caught before a broken glyph can ship.

`rightsCheck(asset, edition, channel, date)` must return ALLOW before export; REFUSED, EXPIRED or
UNKNOWN in a production output is a hard fail. Logos are protected separately: minimum dimensions,
aspect preserved, no unintended crop, no stretch, clear space where the brand profile defines it.

Deterministic brand graphics are compared to the brand profile with ΔE00 (CIEDE2000): ≤2 pass, 2–5
warning, >5 fail for primary brand elements. Not applied to photography.

## 18–22. PDF and print preflight

Every frozen PDF is inspected: page count, size, orientation, embedded and broken fonts, missing
images, invalid objects, transparency compatibility, metadata, readability — and every page is
rendered to an image as a validation pass. A page that will not render is a `CRITICAL_FAIL`.

Print uses a stored printer/output profile (`bleedMm`, `safeMarginMm`, `requiredColorSpace`,
`minimumPPI`, PDF standard such as PDF/X-4), validated mathematically: 3mm bleed on 210×297 means a
216×303 document, bleeding elements reaching the boundary and important text inside the safe margin.
Colour space and output intent are detected rather than assumed, and conversion goes through a
controlled pipeline. A missing font is a hard fail; an unexpected substitution is a fail.

## 23–24, 54–59. Versions, revisions and sending

Republish is deterministic: v1 stays immutable, v2 gets new `contentHash`, `layoutHash`, `pdfHash`
and `printHash`, the email log is untouched, nobody is emailed, and the web shows the intended
version. Send Again is a separate operation with its own batch id, recipient count and provider
events; delivery records reconcile exactly to eligible recipients, and previous logs are never
reused or overwritten.

A revision is transactional: `revisionNumber`, requested operations, pre- and post-state hashes,
affected entities, output invalidations, status. A failed revision costs no quota; a successful one
costs exactly one however many operations it carried. Rollback restores the exact prior state,
verified by hash — an approximation is not a rollback.

Frozen outputs store the `editionContentHash`, `layoutHash`, `brandHash` and `assetHash` they were
built from. When the current hashes differ the output is `STALE`. No guessing.

## 25–32. Email

One central definition of every formula, with denominators that never move:

```
deliveryRate     = delivered / acceptedByProvider
openRate         = uniqueOpenRecipients / delivered
clickRate        = uniqueClickRecipients / delivered
openedThenClicked = recipients with both events
```

Tracked per send: eligibleRecipients, attempted, acceptedByProvider, delivered, bounced, opened,
clicked, unsubscribed, complained. Resend webhooks are signature-verified, idempotent, deduplicated
by provider event id and workspace-scoped — a duplicate delivery must not count twice. Sending
domains show real SPF/DKIM/DMARC state and are not READY until the provider confirms.

Before a send the HTML is validated (structure, image URLs, alt text, links, unsubscribe,
responsiveness, unsupported constructs), rendered at desktop and mobile widths and measured:
`documentScrollWidth <= viewportWidth + tolerance`, no clipping, no broken images, no unreadable
mobile type. Every link is extracted and checked for syntax, destination, tracking wrapper, and the
absence of localhost, staging hostnames and empty hrefs. Bulk email ships with the opt-out behaviour
the provider and the law require, including List-Unsubscribe one-click where relevant.

## 33–36. Web

Broken links, missing media, layout overflow, accessibility, Core Web Vitals (LCP, INP, CLS at P50,
P75, P95, with the measurement version stored), responsive behaviour and SEO metadata. WCAG 2.2 AA
for public output: contrast, alt text, labels, heading hierarchy, focus, keyboard navigation, ARIA.
No known critical automated violation ships. Private and unpublished editions are never indexed.

## 37–41. Across outputs

One canonical edition content model. Copy may shorten and rephrase between web, email, PDF, print,
carousel, story, post and video — facts may not mutate. Names, numbers, dates, titles, quotes and
major claims are cross-checked; 12 October on the web and 21 October in the PDF is a fail.

Video verifies resolution, aspect ratio, frame rate, duration, audio stream, caption safe area, text
overflow, audio clipping, sync and decode integrity. Fixed image outputs verify exact canvas size,
safe areas, text geometry, brand consistency, image quality and export decode. Dimensions come from
versioned output profiles — `EMAIL`, `WEB`, `PDF_SCREEN`, `PRINT`, `CAROUSEL`, `STORY`,
`SOCIAL_POST`, `VIDEO_VERTICAL`, `VIDEO_HORIZONTAL` — not from constants scattered across the code.

## 42–47. Regression, corpus and density

Deterministic layout snapshots compared by geometry, page count, component placement and rendered
image (pixel diff, SSIM, bounding-box diff), so a layout-engine change cannot silently move two
hundred components. A permanent golden corpus covers text-heavy, image-heavy, interview, charts,
long and short titles, logo-only attachments, portrait, landscape and no photo, multiple sections,
French, English, mixed language, and print, email and video editions.

Image selection keeps labelled cases (`VALID_PHOTO`, `LOGO`, `CHART`, `SCREENSHOT`, `LOW_RES`,
`BAD_RIGHTS`, `ARCHIVED`, `ODD_ASPECT`) with measured precision, recall and false-positive rate;
logo-as-photograph must be near-zero.

Density is quantitative — text area over usable area, image area, white-space ratio, characters per
page, components per page — and feeds layout decisions instead of a model being told a page "feels
dense". Orphans, widows, isolated headings, captions divorced from their image and badly split
quotes are found in the layout tree and repaired. Balance statistics flag suspicious pages for an
art director rather than reducing aesthetics to a formula.

## 48–53. Tenancy, reconciliation, storage, providers

Customer analytics are strictly workspace-scoped; the Super Admin has an explicit platform scope;
automated tests prove A sees only A, B only B, admin A+B. Dashboard figures reconcile to raw records
by the documented formula — no mysterious gap between 9,431 and 9,487. Rights metrics are derived
from real rights records, workspace-scoped, never aggregated across tenants in a customer view.

Object storage keeps checksum, size, bucket, object key and asset version, and detects missing
originals, missing thumbnails, orphan objects and broken references; the targets are zero active
missing objects and zero hash mismatches. A periodic health check does a real upload, read, signed
URL and delete on a health-check object, and the console shows last healthy, latency and failure
count without exposing secrets.

For every external provider — OpenAI, Higgsfield, image and video models, ElevenLabs, Resend — the
provider, model, job id, latency, cost, success, retries and QC result are recorded. A provider
reporting success does not mean the output passed Briefly's QC.

## 60–62. Cost and quality intelligence

Customers never see provider or model cost; the Super Admin does, aggregated exactly from a ledger
that stores provider, model, usage units, price version, estimated cost, workspace, edition, output
and revision. A platform quality page reports PDF preflight pass rate, print failures, email
broken-link and render-failure rates, web accessibility violations, image-eligibility rejections,
low-resolution counts, missing storage objects, layout and typography overflow counts, rights
failures, cross-output factual mismatches, revision and republish failure rates and provider failure
rates — broken down by workspace, output type, layout system, provider and software release, with
alerts when a release moves a rate (0.2% → 3.1% overflow, 0.1% → 2.7% broken email images).

## 63–65. Gates and order

Quality is not one number. Hard gates that block READY or PUBLISH include an unapproved rights
asset, a missing image, a corrupt PDF, clipped text, cross-tenant analytics, a broken unsubscribe, a
wrong critical number, a missing font and wrong print geometry.

Repairs are deterministic where possible — reflow overflow, swap in a valid asset, regenerate a
thumbnail, rerender a broken export, regenerate an asset URL, fix a heading orphan — and always
followed by a remeasure. Logging a defect is not handling it.

Creative QA runs **after** technical preflight passes, never instead of it.

## 66–68. Testing the tester

Deliberately broken fixtures prove the engine works: a 1px overflow, a missing thumbnail, a 150-PPI
hero, a logo offered as a photo, expired rights, a wrong date, a wrong percentage, a missing
embedded font, a broken PDF page, missing bleed, a broken email image, a dead link, a duplicated
Resend webhook, a cross-workspace analytics row, a missing storage object. Detectors report their
own precision, recall and false positive and negative rates.

The end-to-end case builds a realistic edition with every one of those defects injected at once. The
system must find each relevant problem independently, repair what is repairable, block what is not,
remeasure, and only then allow READY or PUBLISH.

---

## The absolute rule

"The art director thinks it looks good" is not preflight. "The email preview opened" is not email
QA. "The PDF exported" is not PDF QA. "The chart looks correct" is not factual validation.
