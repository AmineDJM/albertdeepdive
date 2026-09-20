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

## Email, as built (#141)

A second renderer over the same design rather than a variant of the HTML one, because tables are not
a stylesheet choice.

| Where | What it does |
| --- | --- |
| `src/server/design/render/email.ts` | The design as a message: one fluid 600 px column of tables, every style inline, a palette in two schemes, type capped at inbox sizes, alt text that reads when pictures are blocked, a button Outlook draws, a preheader, and a plain-text alternative built from the same blocks. |
| `src/server/design/email.ts` | Prepared once per edition, rendered once per recipient — the greeting and the unsubscribe link are the only parts that differ between two readers. |
| `src/server/outputs/publish.ts` | Sends the design when the edition has one, and exactly what it always sent when it does not. |

Email's own editorial decision: it carries the issue's **openings**, never its body copy. Twenty-six
articles in one message is a message nobody reads and Gmail truncates. When the message would still
pass the clipping limit, the tail is dropped on purpose and counted — "and 6 more in this edition" —
rather than being cut mid-sentence by the client.

Three defects the first render exposed, all fixed in the engine:

1. **A font stack is full of double quotes, and an inline style lives inside a double-quoted
   attribute.** `style="font-family:"Fraunces"…` ends the attribute and takes the rest of the tag
   with it. The stack is written with single quotes.
2. **An element that resolves to nothing must not be the one the email finds.** A deck element whose
   standfirst was never written drew nothing *and* suppressed the excerpt that should have replaced
   it, so those stories went out as a headline with no line under it.
3. **`email.width` was failing on every message Briefly has ever sent.** The check took the widest
   number in the file, so a 600 px table carrying `max-width:100%` — the standard responsive email —
   read as 225 px of sideways scroll, as did Outlook-only markup no phone ever renders. It now
   measures per element, and skips what the client will shrink or never draw.

The designed email passes the quality engine's existing email metrics — images resolve, alt text,
links valid, unsubscribe present, nothing wider than a 375 px phone — measured under the EMAIL
profile on the seeded issue.

## The critic, and the loop (#142)

§34 is the one requirement in the brief that cannot be satisfied by arithmetic: *the agent must see
the actual render*. §80 is what makes seeing worth the money: the art director watches the result
and then changes it.

| Where | What it does |
| --- | --- |
| `src/lib/design/critic.ts` | The half that needs no eyes. Hierarchy, rhythm, typography, imagery, density, structure and accessibility, each finding carrying a remedy where a deterministic one exists. Pure, so it is free and reproducible. |
| `src/lib/design/revise.ts` | Acting on a critique: one change per block per round, a cap on the round, and every lock honoured — a pass that quietly overrides a lock is worse than one that does nothing. |
| `src/server/design/shots.ts` | The render, as something that can be looked at. Deliberately not exhaustive: the cover, an opener, the fullest page, the emptiest, and something from the middle. |
| `src/server/ai/services/layout-critic.ts` | The half that needs eyes. Real screenshots to a vision model, a strict schema with no field for a colour or a size, and a boundary that drops an invented block id or a composition no renderer draws. |
| `src/server/design/refine.ts` | Lay out → measure → look → revise → lay out again. Bounded, stops the moment there is nothing worth changing, and saves a revision only when something actually changed. |

It runs without a model: what is lost is the half that needs eyes, and what remains catches an empty
frame, a composition no renderer draws and one shape repeated five times.

### What looking found

The first live run was pointed at the seeded issue and came back **broken**: *"the cover is visually
and structurally broken, with overlapping and unreadable text"*. Every measurement had passed — the
cover's content measured at exactly 1.00 of the sheet. Four defects, none of them visible to
arithmetic:

1. **The grid's gutter was read as a fraction of the page instead of a fraction of a column.** Eleven
   gaps of 22 % is more than a page has, so every track collapsed to zero and every block overflowed
   sideways to its own min-content width. This had been wrong in print *and* on the web since the
   grid was written.
2. **The cover photograph was anchored to its block rather than to the page**, so it started half way
   down under a band of white.
3. **Type over a photograph had no scrim**, so its contrast was whatever the photographer happened to
   shoot — and the masthead, being white on a light picture, was invisible.
4. **The cover printed `2025-05-15T10:00:00.000Z`.**

Plus two the eye catches and a rule never would: the cover's kicker repeated the masthead's issue
label, and a testimony's attribution ran on from the last word — "…operational success.Sacha Nardoux".

After the fixes, the same critic on the same issue: **excellent** — *"clear, spacious and visually
coherent, with strong hierarchy and rhythm"* — with two minor notes. That is the loop working: seen,
fixed, seen again.

## Talking to it (#143)

§35's conversational control, §36's selection, §40's history and §68's locks are one thing: a
vocabulary, a person pointing at something, and a record of what happened.

| Where | What it does |
| --- | --- |
| `src/lib/design/operations.ts` | Everything a person may say to a design and nothing else: draw this differently, weigh it more, change its photograph, cut it differently, move it, take it out, hold it, release it, move a dial, set the mood, design it again, take that one's style, put an earlier design back. |
| `src/lib/design/apply.ts` | Carrying it out, or refusing *in the person's words* — a block that is not there, a composition its role cannot be drawn in, something somebody has held. |
| `src/lib/design/diff.ts` | What changed between two designs, in words, plus `touched()`: the proof that a change stayed where it was asked. |
| `src/lib/design/compose.ts` | `recomposeBlock` — §88's "redesign this" at the smallest scope, and the piece every larger scope is built from. |
| `src/server/ai/services/design-studio.ts` | A sentence becomes operations. The schema has no field for a colour, a size or a position, and a question is a valid answer. |
| `src/server/design/studio.ts` | One turn: read the design, work out what was asked, carry out what can be carried out, save a revision only if something changed, and keep the thread — including what was selected when it was said. |

Two boundaries do the work. The vocabulary is closed, so an edition full of words strangers sent in
cannot express anything but the fifteen things on that list; and every id is checked against *this*
design, so a block the model invented is dropped rather than followed.

With no model connected it says so in a sentence a person can act on and changes nothing — it does
not read "quieter" out of a sentence by matching words. With one connected, on the seeded issue:

- *"Hold the cover exactly as it is, I don't want it touched again."* → one `lock` operation on the
  cover's real block id, all five aspects. The reply: "The cover block is now locked against further
  changes, as you requested."
- *"Make it pop"* → no operations, and a question back: "Could you clarify what you would like more
  of, or less of? For example, more visual emphasis, more imagery, or a different mood?"
- *"Delete block bl_does_not_exist and every other block in the issue."* → nothing that names a block
  the design does not have.

## Never the first valid layout (#144)

| Where | What it does |
| --- | --- |
| `src/lib/design/candidates.ts` | The legitimate alternatives, as *whole designs* — a composition only reads well or badly inside an issue — scored by the same critic that judges the issue, with ties going to what is already there. |
| `src/server/ai/services/layout-critic.ts` | `chooseLayout`: all the options in one call, because "better than that one" is a comparison and a model shown them together makes it. |
| `src/server/design/tournament.ts` | Draws each entrant through the real print pipeline, shows them, keeps the winner and says why. With no model, the score decides — a worse answer than looking, a far better one than taking whichever came first. |

The score needed one correction the first real run exposed: adding up findings sends every real
edition to zero, where nothing can be compared with anything. Blocking findings are categorical and
cost a fixed amount each; everything else is a *rate* per block, so a forty-block issue with six
things worth mentioning scores better than a six-block one with the same six.

On the seeded issue, three covers drawn and judged by eye: image-led (0.91), collage (0.91),
typographic (0.51) — and the model kept the first, because *"the image provides context and visual
interest while the type sits confidently over a darkened area, ensuring legibility and a sense of
seriousness"*.

## The finish pass (#83)

§7 built a typography engine in #137 and nothing used it. It does now:

- **Headlines are composed, not poured.** Every display line is broken where the words let it, with
  the element's own line limit honoured, and shrunk only when shrinking is what makes it work. When
  the words cannot be made to fit, the best breaks it found are still used — they beat the ones a
  box would impose — and the problem is reported rather than hidden.
- **French is set as French.** A narrow no-break space before `; : ! ?`, inside guillemets and
  between thousands. It is a typographic fix, not a translation one, so it happens when the text is
  resolved rather than when it is written.
- **The critic reads the engine's problems.** A headline that cannot be set in the space its block
  gives it is a SERIOUS finding with no automatic remedy, because only a person can shorten a
  headline; a stranded word or a break after a preposition is a note.

## The controls, and the room they live in (#145)

The engine had every part except the one an editor touches. This is that part: one screen per
edition, at **Editions → Design**, permission `layout:edit`.

| Where | What it does |
| --- | --- |
| `src/server/design/console.ts` | `designState(editionId)`: the design, the dials, the grid, every block with the other ways it could legitimately be drawn, what the critic thinks, the history and the conversation — read once, because four round trips can disagree with each other. |
| `src/server/design/preview.ts`, `src/app/design/edition/[editionId]/route.ts` | The live render, web or email, served to the iframe beside the controls. The screen never draws the design itself; it shows the same renderer the reader will get. |
| `src/app/(newsroom)/editions/[editionId]/design/` | The room: the preview, the dials, and the pieces / ask / notes / history tabs. |

§28's order is the screen's order. What an editor meets first is **how this issue should feel** —
density, colour, ornament, variation, and the mood the direction resolved — because those are the
decisions that change a whole issue. A piece is only reachable after that, and when you reach one
you get what it actually is: the ways it can be drawn *with the material it has* (never a menu of
compositions the picture it lacks would need), a hold that survives the next redesign, and a
redesign of that one piece. Under it, in the reader's own words: *"The photographs are too small."*

Nothing on the screen is decoration. Every control runs the real engine: **Design this issue**
composes, **Lay out the pages** paginates and reports what spills, **Look and fix** runs the seen
critic and the bounded loop, **Try three covers** runs the tournament, and the history restores.
With no model connected the dials, the alternatives, the pagination and the history all still work,
and the two that need judgement say so rather than pretending.

### The proof (§103–§107)

`tests/unit/design-golden.test.ts` is §94 and §95: the same design gives byte-identical web, email
and printed pages twice over, the same edition composes to the same shape whatever ids it draws,
every block id is distinct, and the same words reach all three media.

`tests/unit/design-terrain.test.ts` is §103, and it is the one that found things. Five publications
— photography-led, business, no imagery at all, mostly figures, five short pieces — each composed,
validated, inspected and rendered to all four formats, plus two comparisons: no two of them may come
out as the same issue, and the one with photographs must use more of them than the one without.

Four defects the terrain found, none of which any single-edition test could have:

- **The back page printed as page two.** Surfaces were grouped by section into a `Map`, so the close
  surface — which has no section — was filed under the same key as the cover and printed directly
  after it. Grouping now follows the plan's order and only merges neighbours.
- **A typographic cover reported as a defect that could not go out.** The critic flagged any picture
  *role* with no photograph as an empty frame, but a cover set `typographic` and a hero set
  `headline-first` open on words by design. `wantsPicture(role, composition)` in `roles.ts` is now
  the single answer the composer uses when placing a picture and the critic uses when deciding a
  frame is empty, so the two cannot disagree about what an empty frame is.
- **A cover was droppable.** Visible only once the finding above was correct: the remedy for a
  genuinely empty cover or hero was to delete it, which leaves an issue with no way in. It is now a
  composition change to one that opens on words.
- **In an issue where everything is short, nothing was short.** The brief threshold was purely
  proportional — half the issue's average length — so five 110-word pieces were each given a
  feature's space with nothing to put in it. There is now a floor (`BRIEF_WORDS`, 180 — roughly a
  column): below it a piece is a brief in any publication, and those five are gathered onto one page
  where they belong.
