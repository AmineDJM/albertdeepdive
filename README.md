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
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Running the newsroom](#running-the-newsroom)
- [Exports](#exports)
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

## Architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn-style UI, Lucide |
| Database | PostgreSQL 16 + Drizzle ORM, SQL migrations in `drizzle/` |
| Auth | Cookie sessions (scrypt passwords), roles: super admin, editor in chief, editor, campus editor, contributor, viewer |
| Storage | `StorageAdapter`: local disk (dev) or S3-compatible (S3 / Cloudflare R2 / Supabase Storage) |
| Jobs | Database-backed queue (idempotent, retries, dead-letter), in-process runner or `pnpm worker`; automation tick endpoint for external cron / Trigger.dev |
| Email | Resend in production, dev mailbox (stored in the database, visible in Settings → Mailbox) |
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

Sign in with `admin@albertschool.com` / `albert-deep-dive` (see `SEED_ADMIN_*`). The seed also
creates `eic@`, `editor@`, `lyon@` (campus editor) and `viewer@albertschool.com` with the same
password.

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
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | `log` (dev mailbox) or `resend` |
| `STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`, `STORAGE_S3_*` | Where originals, variants and exports are stored |
| `JOBS_RUNNER` | `inprocess` (default), `cli` (`pnpm worker`) or `none` |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Chromium used for PDF rendering |
| `AUTOMATION_TICK_TOKEN` | Protects `POST /api/automations/tick` for external schedulers |

Behind a corporate egress proxy that injects the OpenAI credentials, leave `OPENAI_API_KEY`
empty and start Node with `NODE_USE_ENV_PROXY=1` (Node 22.21+) so that `fetch` honours
`HTTPS_PROXY`.

Runtime settings (masthead, contact, campaign day defaults, default sections, automation
toggles, AI budget, retention) are edited in **Settings** and stored in `system_settings`.
Prompts are versioned in **Settings → Prompts**.

## Running the newsroom

- **Overview** — the current edition, phase, deadlines, coverage by campus, flags, AI cost.
- **Editions → Control room** — the whole workflow (collect, organise, write, edit, layout, QA, publish).
- **Campaign** — schedule, contributor targets per campus, invitations, reminders, response tracking.
- **Inbox** — triage submissions (needs review, missing information, duplicates), bulk actions.
- **Stories** — clusters and story candidates with sources, facts, quotes, people, media, AI notes.
- **Articles** — the editor: headline, standfirst, blocks, pull quotes, provenance ("Why is this sentence here?"), explicit AI actions, revision history, approval.
- **Media** — library with rights status (green / yellow / red), quality, duplicates, crops.
- **Layout** — the flatplan: drag-and-drop pages, templates, locks, fit estimates.
- **QA & publish** — quality gates (overrides require a reason), exports, versions, approval, archive.
- **Automations** — the nine scheduled steps, the job queue (retry, cancel, inspect a dead letter) and the AI call log.
- **Analytics** — contributions, response rates, conversion, section coverage, AI cost, time to decision.
- **Archive** — the published back catalogue with full-text search and the PDF and DOCX of every issue.
- **Contributors / Campuses / Settings** — organisation and system. Settings also holds the development
  mailbox (what each contributor actually received, personal link included), the job queue and the
  audit trail, where every action and every justified decision is recorded.

Contributors never need an account: they receive `https://<app>/contribute/<token>` and use a
mobile-first form that adapts to the story type (Business Deep Dives get their structured
questions). Requests for more information use the same mechanism (`/respond/<token>`).

## Exports

`pnpm export:sample` renders the seeded edition to `exports/*.pdf` and `exports/*.docx` and
prints the validation report. In the app, **QA & publish → Export** creates a publication version
(`v0.1`, `v0.2` … `v1.0` when published); each version stores the canonical document, the
validation and layout reports and its PDF/DOCX assets. Published versions are immutable.

PDF rendering needs Chromium. Playwright installs one with `pnpm exec playwright install chromium`,
or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Tests

```bash
pnpm typecheck        # next typegen + tsc
pnpm lint
pnpm test             # vitest unit + integration (uses DATABASE_URL_TEST, seeds it)
pnpm test:e2e         # Playwright: the critical journey, end to end
```

`pnpm test:e2e` reseeds the development database first, because the journey changes the newsroom
as it goes: it launches a campaign, files a contribution through the public form with no account,
runs the pipeline, settles a disputed fact, approves an article, renders a version and works the
quality gates. Set `E2E_SKIP_SEED=1` to run it against the database as it stands.

## Deployment

1. Provision PostgreSQL, an S3-compatible bucket and a Resend API key.
2. Set the environment variables (`AI_PROVIDER=openai`, `EMAIL_PROVIDER=resend`, `STORAGE_PROVIDER=s3`, a strong `AUTH_SECRET`).
3. `pnpm build && pnpm start`, plus either `pnpm worker` as a second process or a cron / Trigger.dev
   task calling `POST /api/automations/tick` (Bearer `AUTOMATION_TICK_TOKEN`) every hour.
4. Run `pnpm db:migrate` on deploy. Seed only demo environments.
5. Chromium must be available to the server process for PDF exports (a container image with
   Playwright's Chromium, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/EDITORIAL_DNA.md](docs/EDITORIAL_DNA.md)
- [docs/UI_CONVENTIONS.md](docs/UI_CONVENTIONS.md)
