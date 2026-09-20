# The editorial design engine

Status: **planned, on top of a real renderer.** Briefly already paginates, measures and preflights a
printed issue; what it does not do is *art-direct* one. This document is the survey that says which
is which, and the order the rest gets built in. The requirement it answers is the 108-point
Editorial Design Engine brief.

The standard, verbatim from §101 of that brief, is the only acceptance test that matters:

> could this plausibly have been designed by an excellent editorial designer?

Not "better than a Mailchimp template".

---

## What exists today

| Where | What it does | What it is worth to the new engine |
| --- | --- | --- |
| `src/lib/publication/document.ts` | `EditionDocument`: sections, articles as typed blocks, media with print/web/thumb sources, pages, TOC, warnings. Schema-versioned. | **Kept.** This is the content model, and it is a good one. The design engine does not replace it; it stops being the thing that also decides layout. |
| `src/server/publication/paginate.ts` | Renders in Chromium, measures every block, flows text across pages, applies copyfit levels and image-scale levers, generates continuation pages, reports density. | **Kept, and promoted.** This is a real measuring layout engine, which is the expensive half of §15 and §65. It becomes the *print resolver* of a design rather than the thing that arranges an issue. |
| `src/server/publication/templates/` | Eighteen page templates (`COVER_A`, `ARTICLE_TWO_COLUMN`, `NEWS_GRID`, `SHORTS`, …) as HTML functions, plus the print CSS. | **Re-cast.** §3 forbids a template-first architecture. These are not deleted: each becomes a *composition* of the design grammar (§4), reachable only through a design decision, never chosen by name from a menu. |
| `src/server/publication/flatplan.ts` | The page plan: which stories on which page, with which template, locked or not, with validation. | **Re-cast.** The plan stops being hand-assigned templates and becomes the resolved print surface of an `EditionDesign`. |
| `src/server/publication/page-quality.ts`, `layout-audit.ts` | Fill ratio, overflow, under-filled pages, per-issue tables. | **Kept as the measurable half** of the LayoutCritic (§42). It cannot see, which is the other half. |
| `src/lib/brand/system.ts`, `typography.ts`, `colour.ts`, `deltae.ts` | `BrandSystem` → `compileBrandSystem` → tokens: surfaces whose every foreground is proven against its own background, seven-step scale, shape, imagery, motion. Four self-hosted families, paired per personality, with the model explicitly forbidden from choosing a font. | **Kept and extended.** §61's tokens and §25's colour reasoning already exist and are already enforced. §26's genome is the layer above them. |
| `src/server/ai/services/art-director.ts` | A structured brief for a *carousel*, with a deterministic local fallback and a strict schema. | **The pattern to follow** for §2, at edition scale: the model decides intent, the renderer executes, and there is always a version that works with no model connected. |
| `src/server/qc/` | 44 metrics, output profiles, measure → compare → fail → repair → **remeasure with the same code**. | **Kept.** The Premium Finish Pass (§84) is this loop pointed at design findings, not a second quality system beside it. |
| `src/server/outputs/email-edition.ts` | 185 lines of hand-written digest: one 600px column, tables, inline styles, escaped. | **Replaced** by a renderer of the same design (§13). Its email-client knowledge is the part worth keeping. |
| `src/app/r/[slug]/page.tsx` | The public web edition, a bespoke React page that re-derives the issue from the document. | **Replaced** by a renderer of the same design (§14). |

Two things are therefore already true and should not be rebuilt: **Briefly can measure a rendered
page**, and **Briefly's colour and type decisions are already tokens with guarantees**. The gap is
everything between "here is an issue" and "here is how this issue should look".

## What is missing, in the brief's own terms

1. **No design model.** A page carries a template code and a list of article ids. There is nowhere to
   say *this is the lead, it gets the weight, and it must not break across a spread* (§63, §64).
2. **No editorial hierarchy.** Every article is an article. COVER/LEAD/MAJOR/STANDARD/BRIEF/SUPPORTING
   does not exist, so design cannot reflect it (§5).
3. **Template-first.** `setPageTemplate(editionId, pageId, "ARTICLE_TWO_COLUMN")` is the interface
   (§3).
4. **One output is designed; the others are transcribed.** Print is art-directed by templates, email
   is a hand-written digest, web is a React page. The same edition has three unrelated visual
   identities (§1, §66, §96).
5. **Nothing looks at the result.** Quality is measured in numbers; no part of the system has ever
   *seen* page 6 (§34, §42, §80).
6. **Images are placed, not directed.** No focal points, no per-medium crops, no curation, no memory
   of what has already run (§19, §20, §53, §54, §55).
7. **No publication identity** between the organisation's brand and the edition (§27).
8. **No way to talk to the design.** The Studio revises *content*; "page 7 is boring" has nowhere to
   go (§33).

## The decision

One new layer, between the document and the renderers:

```
EditionDocument            what the edition says          (exists)
        │
        ▼
BrandGenome                who the organisation is        (#134)
PublicationIdentity        what this title looks like     (#134)
EditionArtDirection        what this issue is             (#135)
        │
        ▼
EditionDesign              how it is composed             (#133)
   sections → surfaces → blocks → elements
   roles, hierarchy, constraints, token references
        │
        ├──► print resolver   → pages, coordinates, PDF   (#139, on paginate.ts)
        ├──► web renderer     → responsive editorial      (#140)
        ├──► email renderer   → tables, inline, dark      (#141)
        └──► docx renderer    → editable deliverable      (exists, adapted)
```

Four properties this layer must have, each of which is a thing the brief asks for and a thing the
current architecture cannot express:

- **Intent, not coordinates.** A block says "editorial split, image leads, keep together"; each
  renderer decides what that means on A4, on a phone, and in Outlook (§66). Print resolves to
  coordinates — but as the *output* of the constraint solver, never as its input (§65).
- **Constraints, not arrangement.** Min/max measure, aspect, priority, keep-together, avoid-break,
  focal point, safe area, maximum headline lines (§64).
- **Roles, not values.** A block references `display-l` and `surface-brand`, not `48px` and
  `#1F3A5F`, so one publication identity restyles an issue without re-laying it out (§61).
- **Addressable.** Every block and element has a stable id, because §35's "make *this* bigger",
  §86's locks, §38's selective recomputation and §39's history all need something to point at.

## Build order

The brief's own priority list (§102), as the thirteen tasks that follow this one. Each is a vertical
slice that renders something, because §103 is explicit that abstractions which compile are not
progress.

| # | Slice | Why here |
| --- | --- | --- |
| 133 | The `EditionDesign` scene graph | Everything else consumes it. |
| 134 | Brand genome → publication identity → edition art direction | The design's inputs, before anything decides anything. |
| 135 | The DesignDirector: analysis → art direction → design plan | §79: plan the rhythm before rendering, or get a stack of identical blocks. |
| 136 | Design grammar and the editorial grid | The vocabulary the Director composes in. |
| 137 | The typography engine | §7: the most important single capability, and the one that separates editorial from SaaS. |
| 138 | Image art direction, cropping, media memory | Half of what makes a page look designed. |
| 139 | The paginated print engine on the new model | Proves the design survives the hardest medium first. |
| 140 | The responsive web renderer | |
| 141 | The email renderer | Last of the three, so email's limits never set the ceiling (§13). |
| 142 | LayoutCritic and the render → inspect → revise loop | §34 is non-negotiable and needs something to look at, which is why it follows the renderers. |
| 143 | Talking to the design: selection, locks, history | |
| 144 | Alternatives, tournaments, candidates | §41: never ship the first valid layout. |
| 145 | Controls, console, golden tests, and the proof on real editions | |

## The terrain

Nothing here is finished because it compiles (§103). Five editions, built from real content, are the
standing test bed, and each must render to web, email, PDF and a mobile preview:

| Terrain | Shape | What it is meant to break |
| --- | --- | --- |
| A | Photography-heavy community newsletter | Curation, crops, full-bleed rhythm |
| B | Serious investor/business publication | Formality, restraint, data with prose |
| C | Almost no imagery | §99: typography and space must carry it |
| D | Data-heavy | §49, §50: stat blocks and editorial graphics |
| E | Five short stories, email-first | The common case, and the easiest to make look generic |

Plus the cases §97 and §98 name: very long and very short headlines, French, English, Italian,
accented characters, quotes, tables, twenty briefs, one enormous article.

The acceptance runs are §104's blind before/after against today's renderer, §105's conversation
("it's too dense", "less purple", "apply everything"), §106's power-user path (select, relayout,
crop, lock, redesign the rest, undo) and §107's whole flow on Edition #6 of a title that already has
five.

## Rules that hold across every slice

- **The model decides intent; the renderer executes.** No model paints text, logos, tables or layout
  into an image (§62). This is already how the Creative Studio works and it does not change here.
- **Deterministic rendering.** Same design in, same pixels out, or the golden tests in §95 are
  meaningless.
- **No card soup.** §71 and §72 are design requirements with the same standing as any other: rounded
  rectangles are one tool, and gradients, glows and sparkles are not editorial design.
- **Nothing is finished until it has been looked at.** Measured, then seen (§34, §80).

## Print, as built (#139)

Print is the medium that cannot be fudged, so it was built before the other two could be trusted.

| Where | What it does |
| --- | --- |
| `src/lib/design/pages.ts` | Pure. Surfaces → numbered pages with sides; `breakPoint` (where a page may legitimately be cut), `reflow` (carry what did not fit), `splitCopy` (break a story over the turn), `absorb` (pull a page up that did not earn its paper), `tighten` (copyfit), `demote` (move the lowest priority off a page that cannot be made to fit), `planIntegrity`. |
| `src/server/design/render/print.ts` | The stylesheet for paper (page box, sheet inside the grid's own margins, folio, bleed to the trim, picture frames sized by importance, four copyfit steps), the page markup, `PRINT_MEASURE_SCRIPT`, and `paginateDesign` — the render → measure → act loop. |
| `src/server/design/render/pdf.ts` | The loop in a real Chromium, with fonts and photographs embedded, printed and stamped. |
| `src/server/design/print.ts` | The join to the workspace: which design, which document, which brand, which language, which focal points — all under the tenant's scope. |

Four things the first run on a real issue taught, all fixed in the engine rather than in the test:

1. **A picture's own pixel width must not decide the layout.** Measuring with thumbnails and printing
   with full-size files produced two different publications, because a placed `<img>` sized itself
   from its intrinsic width. `figure img { width: 100% }` — the composition owns the frame.
2. **A photograph needs a frame height on paper.** Unbounded, one picture became four pages. The cap
   comes from what the picture is *for* (`data-importance`, and the composition it sits in), which is
   information the design already carries.
3. **Copyfit has to tighten space, not only type.** A reader sees a smaller letter long before a
   smaller gap, so a page set one step tighter now loses 6 % of its air and 2.5 % of its type.
4. **Filling gaps may not create overflow.** Two pages are merged only when both have been *measured*
   to fit together, and the loop ends with repair-only rounds so a late absorption can never leave a
   page spilling off the sheet.

On the seeded issue, without a model: 39 pages, nothing overflowing, one relaxation recorded (a pull
quote moved off an opener that could not hold it). The pages that remain under-filled are reported
rather than hidden — they are a composition problem, which is #142's to solve.
