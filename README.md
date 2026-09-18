# Albert Deep Dive

**The automated monthly newsroom and publishing system of Albert School.**

Albert Deep Dive turns raw information sent by students, campus representatives, associations
and staff into a verified, AI-assisted, human-approved monthly publication — and exports the
same canonical edition to a print-ready PDF and an editable DOCX.

```
RAW HUMAN INFORMATION → STRUCTURED SOURCES → VERIFIED FACTS → STORY CLUSTERS
→ EDITORIAL SELECTION → AI-ASSISTED WRITING → HUMAN REVIEW → DETERMINISTIC LAYOUT
→ QA → PUBLICATION
```

Human sources remain the ground truth. AI never publishes anything on its own; an editor in
chief approves every issue.

## Contents

- [What it does](#what-it-does)
- [The interface](#the-interface)
- [Standard and Advanced](#standard-and-advanced)
- [The public gallery](#the-public-gallery)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Object storage, in one press](#object-storage-in-one-press)
- [Running the newsroom](#running-the-newsroom)
- [Exports](#exports)
- [Pictures](#pictures)
- [Tests](#tests)
- [Deployment](#deployment)
- [Documentation](#documentation)

## What it does

Every month:

| Day | Automation |
| --- | --- |
| 1 | A new edition exists (default sections, campaign scheduled) and contributors receive personal, tokenised contribution links |
| 4 | Reminder to non-respondents |
| 7 | Last-day reminder |
| 8 | Grace-period reminder, then the campaign closes |
| after close | Submissions are normalised, classified, de-duplicated, clustered, fact-extracted, scored and turned into story candidates; editors are alerted |

Editors then select stories, draft articles with AI assistance (every sentence traceable to its
sources), approve them, lay out the issue on a drag-and-drop flatplan, pass the quality gates and
export. The editor in chief approves; the version becomes immutable and is archived.

## The interface

Two surfaces, one brand. The **client workspace** is light, editorial and calm: a persistent left
column with the supplied Briefly logo, the organisation, the edition in hand and six places to
work — Home, Content, Editions, Library, Audience, Analytics — then Brand and Settings, and at the
foot the plan, notifications, search and the account. Home answers three questions on arrival:
what is happening (the organisation's pulse), what needs a person (the next edition, its gaps and
one thing to do), what can go out next (recent editions as the shapes they take: Email, Web, PDF,
Print, Video, Social). Content is the organisation's stories in four states — Ready, Needs review,
Missing information, Used — with the contributions behind them. The Library is the organisation's
visual memory, sorted onto shelves by what the describer saw, never filed by hand. An edition opens
as a focused workspace with six doors: Overview, Stories, Design, Outputs, Distribution, Settings
(and Analytics once it has gone out); every earlier tab is a room behind one of them.

The **Super Admin console** at `/admin` is a separate product surface — dark, dense, operational —
for the person who runs Briefly: Overview (MRR, run rate, organisations, subscribers managed,
platform health), Organizations and Users, Plans & pricing and Billing, Usage & costs, Providers,
Jobs, Feature flags, Audit log, Support and System. Only a platform super admin reaches it, checked
server-side on the real role; everyone else is told nothing exists there. Old `/platform` links land
on their new names.

Design tokens live in `src/app/globals.css` and `src/lib/brand/palette.ts`: neutrals from the
logo's charcoal and paper, one indigo accent read off the logo, the rest of the logo's sweep held
for meaning (money, audience, attention, done) and never for decoration.

## Standard and Advanced

One rule decides what the interface shows: a reasonably smart ten-year-old should be able to run
an organisation's newsletter with it, untrained. So every person starts in **Standard**, and the
product in Standard is four steps — see what Briefly collected, choose what goes in, preview,
publish — with the few decisions that change the result kept in sight and everything else on
smart defaults read from the brand.

- **The sidebar** is six words: Home, Editions, Library — Audience, Analytics, Settings. Content
  folds into the editions, where the stories Briefly found are shown when one is opened; Brand is
  a line under Settings.
- **Home** answers one question, "what should I do now?": the edition in hand and how far it is
  with `Continue edition`, or what has come in with `Prepare my next edition`.
- **`+ New edition`** is one click. Briefly picks the month, the issue number, the title, the
  sections, the dates, the title's usual formats and the contribution campaign from what the
  workspace already knows, and opens the edition.
- **An edition** is a short list of decisions, each one line with what Briefly chose and a
  `Change`: Language, Audience, Publish date, Outputs (`✓ Email ✓ Web + Add format`), Stories,
  Pictures, Tone, and Sender when email is on. Then `Preview` and `Publish`. The full control
  room is one link below.
- **Settings** reads as one line per thing with where it stands — `Brand — Ready ✓`,
  `Email sending — Test mode`, `Audience — 412 subscribers` — and opens only the page that needs
  you.
- **Inside an edition** four doors: Overview, Stories (with the people who sent them and the
  campaign as "Ask for news"), Pictures, Publish. Page plans, exports, audio and the edition's own
  settings wait in Advanced; a link to any of them still opens, and the door it is behind appears
  for as long as you are there.

**Advanced** is the same product with every door open: the eight-entry sidebar, the control
room, the flatplan, exports, prompts, automations, the records. The mode is chosen on
Settings → Profile, stored per person, and changes nothing but what is shown — not an edition,
not the brand, not a setting. Nothing was removed from the product to make Standard: what is not
on the way is a click away in Advanced or in ⌘K.

The core workflows, counted in clicks from the moment you are signed in:

| Workflow | Before | Standard |
| --- | --- | --- |
| Onboarding → first edition | 5 (Editions, New edition, month, dates, Create) | 1 (`Prepare my first edition`) |
| Contributions → edition | 4 (Content, Contributions, edition, inbox) | 2 (`Continue edition`, `Look at what came in`) |
| Edition → publish | 4 (Editions, edition, Distribution, Publish) | 2 (`Continue edition`, `Publish`) |
| Library asset → use in edition | 4 (Library, asset, edition, Media) | 3 (edition, `Pictures`, Upload) |
| Subscriber import → first send | 6 (Audience, Import, edition, Outputs, Email, Send) | 4 (Audience, Import, edition, `Publish`) |

## The public gallery

`/collections` is a curated gallery of real publications, on the marketing site rather than in the
workspace. A visitor browses collections (Universities, Communities, Featured this month…), filters
by category or language, sorts by curated, latest or most viewed, and opens any publication at its
own public address. It is the product arguing for itself with its own output.

**Nothing is public by default, and a collection cannot make it so.** An edition appears only when
all four hold: its title's owner consented, the edition is published, it already has a published
web page, and its workspace is active. A curator adding an edition whose title has not consented
creates a row that draws nothing, and the console says why on the item. Consent is checked when the
gallery reads, so withdrawing it empties the gallery at once, with no cache to purge.

Consent has three sources, all audited: **the customer**, from Publications in their own workspace,
where a switch per title says exactly what would become visible; **a Briefly demo workspace**, which
has no customer to ask and is flagged as such; and **a recorded permission**, which a super admin may
enter for a real customer and which demands a note saying where the permission was given. The
customer's own switch clears any of the three.

Super admins curate at `/admin/collections`: create, publish, feature and pin collections, set
covers, SEO title and description, categories and tags; add, remove, reorder and feature items;
write a per-collection blurb for an item. The gallery counts views, publication opens and clicks
through to signup, with no address, cookie or fingerprint, and reports click-through per collection
and the most opened publications.

## Architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn-style UI, Lucide |
| Database | PostgreSQL 16 + Drizzle ORM, SQL migrations in `drizzle/` |
| Auth | Cookie sessions (scrypt passwords), roles: super admin, editor in chief, editor, campus editor, contributor, viewer |
| Storage | `StorageAdapter`: local disk (dev) or S3-compatible (S3 / Cloudflare R2 / Supabase Storage) |
| Jobs | Database-backed queue (idempotent, retries, dead-letter), in-process runner or `pnpm worker`; automation tick endpoint for external cron / Trigger.dev |
| Email | A Gmail mailbox connected from Settings → Email (SMTP out, IMAP in, app password encrypted at rest); Resend as an alternative; otherwise a development mailbox stored in the database |
| AI | OpenAI structured outputs behind an `AiProvider` interface, versioned prompt templates, deterministic local provider for development and tests, per-call logging (model, tokens, cost, latency) |
| Images | sharp: thumbnails, web/print variants, perceptual hash, quality score, duplicate detection |
| Publication | Canonical `EditionDocument` → HTML/CSS print design system rendered by Chromium (Playwright) to PDF, and the `docx` library to DOCX |
| Tests | Vitest (unit + integration on a dedicated test database), Playwright (end-to-end) |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the code layout, domain model and pipelines,
and [docs/EDITORIAL_DNA.md](docs/EDITORIAL_DNA.md) for the analysis of the reference issue that
shaped the sections, formats and print design.

## Getting started

Requirements: Node.js 22+, pnpm 10, PostgreSQL 16, Chromium (Playwright downloads one; or
point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an existing binary).

```bash
pnpm install
cp .env.example .env            # adjust DATABASE_URL etc.
createdb albertdeepdive && createdb albertdeepdive_test
pnpm db:migrate                 # applies drizzle/ migrations
pnpm db:seed                    # loads the May 2025 special issue as a working edition
pnpm dev                        # http://localhost:3000
```

Two administrators, because running Briefly and running a newsroom are different jobs:

- **Platform admin** — `admin@briefly.press` / `albert-deep-dive` (see `SEED_ADMIN_*`). Briefly's
  own account: the **Platform** console (customers, people, payments, integrations, logs) and the
  right to open any workspace as support. Belongs to no workspace.
- **Workspace admin** — `admin@albertschool.com` / `albert-deep-dive`. The owner of the sample
  newsroom, with everything a customer can do and nothing a customer cannot.

The seed also creates `eic@`, `editor@`, `lyon@` (campus editor) and `viewer@albertschool.com`
with the same password.

> The seed is reconstructed from the real *Special issue N°1 — May 2025*: 26 stories, 31 raw
> submissions, 58 photographs, facts, quotes, people, organisations, a 25-page flatplan and the
> automation history of its campaign. Nothing is invented; contributor emails use `@example.com`.

## Configuration

All settings live in environment variables (see `.env.example`, every variable is documented
there). The important ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` / `DATABASE_URL_TEST` | PostgreSQL connections (tests always use the test URL) |
| `AUTH_SECRET` | Signs sessions, submission links and storage URLs — set a long random value |
| `AI_PROVIDER` | `local` (deterministic, no network) or `openai` |
| `OPENAI_API_KEY`, `AI_MODEL_FAST`, `AI_MODEL_STRONG`, `AI_PRICING` | Model routing and cost estimation |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Only for Resend. A Gmail mailbox connected in Settings → Email overrides all of it and needs no environment variable |
| `STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`, `STORAGE_S3_*` | Where originals, variants and exports are stored. A bucket connected in Admin → Providers overrides all of it and needs no environment variable |
| `JOBS_RUNNER` | `inprocess` (default), `cli` (`pnpm worker`) or `none` |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Chromium used for PDF rendering |
| `AUTOMATION_TICK_TOKEN` | Protects `POST /api/automations/tick` for external schedulers |

Behind a corporate egress proxy that injects the OpenAI credentials, leave `OPENAI_API_KEY`
empty and start Node with `NODE_USE_ENV_PROXY=1` (Node 22.21+) so that `fetch` honours
`HTTPS_PROXY`.

Runtime settings (masthead, contact, campaign day defaults, default sections, automation
toggles, AI budget, retention) are edited in **Settings** and stored in `system_settings`.
Prompts are versioned in **Settings → Prompts**.

### Object storage, in one press

Files go to local disk until a bucket is connected, which is right for a laptop and wrong for every
host that wipes its disk on redeploy. Connecting one is three values and a button, in
Admin → Providers → Object storage. Nothing to set on the host, and no redeploy.

With Supabase: create a bucket (or let Briefly create `briefly-media`), then open Project settings →
Storage → S3 access keys and make a key. Paste the project URL and both halves of the key into the
card, and press **Connect storage**. Briefly completes the project URL into the S3 endpoint, asks
the service which region it is in and remembers the answer, creates the bucket if it is not there,
then writes a real file, reads it back, compares it and deletes it. It says it is connected only
after that round trip, and every step is reported in a sentence you can check.

Any S3-compatible service works the same way: paste that service's endpoint instead of a Supabase
project URL and the rest is identical. Cloudflare R2, Scaleway and MinIO are all path-style, which
is switched on automatically whenever an endpoint is given.

Two things worth knowing. Files already written to disk stay there, so a switch is not a migration.
And the bucket stays private: Briefly signs a time-limited URL for every file rather than making
the bucket public, unless a CDN base URL is given on the card.

## Running the newsroom

- **Overview** — the current edition, phase, deadlines, coverage by campus, flags, AI cost.
- **Editions → Control room** — the whole workflow (collect, organise, write, edit, layout, QA, publish).
- **Campaign** — schedule, contributor targets per campus, invitations, reminders, response tracking.
- **Inbox** — triage submissions (needs review, missing information, duplicates), bulk actions.
- **Stories** — clusters and story candidates with sources, facts, quotes, people, media, AI notes.
- **Articles** — the editor: headline, standfirst, blocks, pull quotes, provenance ("Why is this sentence here?"), explicit AI actions, revision history, approval.
- **Media** — library with rights status (green / yellow / red), quality, duplicates, crops.
- **Layout** — the flatplan: spreads, drag-and-drop pages, templates, locks, pinned stories, the real copyfit measurement, and signing the plan off. The page count on an edition's settings is either a ceiling — the issue is sized to the copy, short stories share a page rather than each getting one — or a promise to a printer, in which case the extent is kept and the room goes on the photographs a story brought and on giving each story more air. Pages that still come out too empty are named in QA rather than quietly shipped.
- **QA & publish** — quality gates (overrides require a reason), exports, versions, approval, archive.
- **Automations** — the nine scheduled steps, the job queue (retry, cancel, inspect a dead letter) and the AI call log.
- **Analytics** — contributions, response rates, conversion, section coverage, AI cost, time to decision.
- **Audio** — the edition read aloud: a digest, a briefing, one article or the whole issue, checked passage by passage and published to readers.
- **Archive** — the published back catalogue with full-text search and the PDF and DOCX of every issue.
- **Contributors / Campuses / Settings** — organisation and system. Settings also holds the development
  mailbox (what each contributor actually received, personal link included), the job queue and the
  audit trail, where every action and every justified decision is recorded.

Contributors never need an account: they receive `https://<app>/contribute/<token>` and use a
mobile-first form that adapts to the story type (Business Deep Dives get their structured
questions). Requests for more information use the same mechanism (`/respond/<token>`).

## Exports

From an edition's live preview, **Download PDF** and **Download Word** hand over the edition exactly
as it stands, unapproved articles included. Nothing is stored and nothing is numbered: it is a copy
of what you are looking at, which is a different promise from a version. The same two buttons sit
beside Preview on the edition's overview.

`pnpm export:sample` renders the seeded edition to `exports/*.pdf` and `exports/*.docx` and
prints the validation report. In the app, **QA & publish → Export** creates a publication version
(`v0.1`, `v0.2` … `v1.0` when published); each version stores the canonical document, the
validation and layout reports and its PDF/DOCX assets. Published versions are immutable.

PDF rendering needs Chromium. Playwright installs one with `pnpm exec playwright install chromium`,
or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Spoken editions

Every edition has an **Audio** tab: the whole issue, a digest, an executive briefing or one article,
read aloud by a voice native to the language the title publishes in. The person chooses in plain
words — voice (auto, female, male, the brand voice), language (auto follows the publication),
accent, style, pace — and a quality: **Preview** is a fast, cheap voice for hearing the words;
**Final** spends the premium voice, offered once the edition is approved. Nothing names a provider,
a model or a setting.

Behind that button: the words are adapted for the ear by a model (numbers, dates, initialisms and
abbreviations as a narrator says them, in the publication's language, never switched to English),
the newsroom's own pronunciations are applied (Settings → Voice), a performance is directed per
context (launch film, newsletter, briefing…) with a sparse palette of audio tags, each passage is
performed with its neighbours for continuity, the passages are mastered into one file with ffmpeg
(loudness, fades, a bed ducked under the voice when there is one), and a check names any passage
that came back silent, cut short, rushed or in the wrong language so it can be regenerated on its
own. A film's narration is timed to its scenes and mixed into the video the moment it is ready. A
finished narration can be published to readers: the web edition then carries a player.

Providers sit behind one interface (`src/server/speech/providers`): ElevenLabs v3 for the final
performance and Flash for previews, OpenAI's speech model as the fallback, Hume and Fish Audio
reachable for benchmarking. Admin → Providers → ElevenLabs holds the key, the models, the
providers per tier, the cost per thousand characters, the caps, the cloning switch and the map from
Briefly's named voices to provider voices; **Set up voices** fills that map from the account and the
shared library. Plans grant narration, the premium voice, audio editions, another language than the
text's, the brand voice, consented cloning, a second take, and minutes a month; the ledger
(`speech_usage`) is what the allowance and the platform's cost views read.

Cloning a real person's voice happens only from Settings → Voice, with the person's consent written
down, confirmed and kept with the voice; withdrawing it deletes the voice at the provider. Nothing
is ever cloned on Briefly's initiative.

## Pictures

Real photographs from the library always come first. For what nobody photographed, a media tab
offers **Generate image**, and every picture's page offers **Edit image**: one sentence in plain
words — "a warm photograph of the terrace at dusk", "make the sky bluer", "remove the bin on the
left" — and, folded away, three dials (preserve more / change more, how many variations, how
photographic). Nothing names a model or a provider.

Every edit is a new **version** of the picture, never a change to it: the original stays untouched,
the line keeps every version with what was asked, what was protected and what came back, and any
version can be compared with the current one, restored, thrown out (greyed, still in the history)
or used as the start of a branch. A generated picture lands in the library like any other, marked
as made by Briefly, with the rights of the pictures it was made from.

Behind the sentence: the rules and, when one is connected, a model write an **edit plan** — the
operation (localised or global), what changes, what must not, which references help (the current
version, the original master, a person, a product, a brand mark), how sensitive the subject is. A
face, a product, a logo, a building or any "only" is HIGH: the master and the references are sent
along, the prompt ends with what must stay, a mask is drawn where the change is confined, and the
answer is checked harder. After three edits in a row on a protected subject the next one starts
again from the master and the accumulated specification, so a face never becomes a copy of a copy.
A **router** (`src/lib/images/router.ts`) then orders the connected models that can honour the
plan — the precise editor for surgical edits, the photorealist for people, products and scenes
with several references, the illustrator for vector work, the typographer for posters, Briefly's
own gradient field as the last resort for an abstract ground — and each answer is measured against
the version before it (how much changed, whether anything did) and, when a seeing model is
connected, looked at; an answer that fails is asked for again, then from the next model. Every
attempt is written down with its model, latency, cost and score: the ledger the routing is tuned
from, and what platform staff see under **Routing** on a version.

Words and logos are never drawn by a picture model: the design engine sets them afterwards, in
the brand's type. Providers sit behind one interface (`src/server/images/providers`): Google's
image model, OpenAI's, Recraft, Ideogram and Higgsfield. Admin → Providers holds each key and
**Picture routing** holds the order per kind of job, the check thresholds, the retries and whether
customers may see the routing. Pictures spend the plan's creative credits.

## Tests

```bash
pnpm typecheck        # next typegen + tsc
pnpm lint
pnpm test             # vitest unit + integration (uses DATABASE_URL_TEST, seeds it)
pnpm test:e2e         # Playwright: the critical journey, end to end
```

`pnpm test:e2e` reseeds the development database first, because the journey changes the newsroom
as it goes: it launches a campaign, files a contribution through the public form with no account,
runs the pipeline, settles a disputed fact, approves an article, signs the flatplan off, renders
the PDF and the Word document from one snapshot, downloads both, works the quality gates as an
editor and then as the editor in chief, publishes the issue and archives it. Set
`E2E_SKIP_SEED=1` to run it against the database as it stands.

## Deployment

### Render, in one click

`render.yaml` describes the whole installation. In Render, choose **New → Blueprint**, point it at
this repository and pick the branch you want to run (the blueprint itself pins no branch, so it
follows whichever one you deploy), and it creates the PostgreSQL database, the web service with a disk for
photographs and exports, and the hourly automation job. The service is built from the `Dockerfile`
on Playwright's own image, so the Chromium that renders the print PDF is already there with the
libraries and fonts it needs. **The only value it asks you for is your
OpenAI API key.** `AUTH_SECRET`, the automation token and the first administrator password are
generated by Render and never shown in the repository; migrations run on every deploy and the
demo issue is loaded only into an empty database. The application reads its own public address
from `RENDER_EXTERNAL_URL` at runtime, so contribution links and signed URLs are correct without
anyone typing a hostname; set `NEXT_PUBLIC_APP_URL` yourself only when you put a custom domain
in front.

Then, in the application:

1. Sign in as the platform admin (`SEED_ADMIN_EMAIL`, `admin@briefly.press` unless you changed
   it) with the password you gave Render when you created the blueprint. Change it in
   **Settings → Profile**. The sample newsroom's own owner is `admin@albertschool.com`, same password.
2. Go to **Settings → Email** and connect the newsroom mailbox (below). Until you do, invitations
   are only recorded, so nothing is sent by accident.

Render prompts you for two values when it creates the blueprint: your `OPENAI_API_KEY` and the
first administrator's password (`SEED_ADMIN_PASSWORD`, used with `SEED_ADMIN_EMAIL`). If you ever
need to reset that password, open the web service's **Shell** and run
`pnpm reset-admin <email> <new-password>`; it touches only that one account.

Nothing else has to be configured. No email provider account, no object storage, no cron service.

### The newsroom mailbox (Gmail)

One Gmail account sends the invitations, the reminders and the requests for more information, and
receives the replies. You connect it from **Settings → Email**. There are two ways.

**One click — Sign in with Google (recommended).** Set two environment variables on the service and
the connection becomes a single button. In Google Cloud → APIs & Services → Credentials, create an
**OAuth client ID** of type *Web application*, add the redirect URI
`https://<your-app-url>/api/settings/gmail/callback`, and copy the client ID and secret into
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (in Render, the web service's Environment tab). If the
mailbox is a Google Workspace address (for example on `albertschool.com`), mark the OAuth consent
screen **Internal** so no Google verification is needed. Then, in the app, open **Settings → Email**
and press **Sign in with Google**: you approve the permissions on Google's own screen and the mailbox
is connected. The app stores only the refresh token, encrypted.

**Or an app password (no Google Cloud project).**

1. On the Google account, turn on 2-Step Verification, then open
   [App passwords](https://myaccount.google.com/apppasswords) and create one for "Albert Deep Dive".
   Google shows sixteen characters.
2. Paste the address and that password into **Settings → Email** and press **Connect the mailbox**.
   The credentials are checked against Gmail before anything is saved, and the password is
   encrypted with `AUTH_SECRET` before it reaches the database. Only its last four characters are
   ever shown again.
3. Leave **File replies in the newsroom inbox** on. A reply from a contributor becomes a
   submission in the triage inbox, attributed to them and marked as having arrived by email;
   a message from anyone else is left in the mailbox untouched. Replies are read on the hourly
   automation tick, and on demand from that screen.

The server needs outbound access to `smtp.gmail.com:465` and `imap.gmail.com:993`; Render allows
both. Consent is never assumed from an email: a submission that arrived this way is marked as
lacking publication consent until an editor confirms it.

### Anywhere else

1. Provision PostgreSQL and a writable directory (or an S3-compatible bucket, with `STORAGE_S3_*`).
2. Set `DATABASE_URL`, a strong `AUTH_SECRET`, `OPENAI_API_KEY` and `AI_PROVIDER=openai`.
3. `pnpm db:migrate && pnpm build && pnpm start`, plus either `pnpm worker` as a second process or
   an hourly `POST /api/automations/tick` (Bearer `AUTOMATION_TICK_TOKEN`); `pnpm tick` does that
   call for you.
4. Chromium must be available to the server process for PDF exports (Playwright's Chromium, or
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE`). The `Dockerfile` in the repository handles this for any
   platform that can run a container.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/EDITORIAL_DNA.md](docs/EDITORIAL_DNA.md)
- [docs/UI_CONVENTIONS.md](docs/UI_CONVENTIONS.md)
