# Albert Deep Dive — Architecture

Albert Deep Dive is the operating system of Albert School's monthly newsroom: it collects
raw information from students and staff, turns it into verified story clusters, assists
editors in writing, lays the issue out deterministically and exports the same canonical
edition to PDF and DOCX.

```
RAW HUMAN INFORMATION → STRUCTURED SOURCES → VERIFIED FACTS → STORY CLUSTERS
→ EDITORIAL SELECTION → AI-ASSISTED WRITING → HUMAN REVIEW → DETERMINISTIC LAYOUT
→ QA → PUBLICATION
```

## 1. Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, React 19, TypeScript) | Server components + server actions + route handlers |
| Styling | Tailwind CSS v4, shadcn-style components (Radix primitives), Lucide icons | Tokens in `src/app/globals.css` |
| Database | PostgreSQL 16 + Drizzle ORM (`postgres` driver) | Schema in `src/server/db/schema`, migrations in `drizzle/` |
| Auth | Cookie sessions stored in DB, scrypt password hashing, roles + permissions | `src/server/auth` |
| Storage | `StorageAdapter` interface: local disk (dev) and S3-compatible (R2 / S3 / Supabase) | `src/server/storage` |
| Jobs | DB-backed queue (`jobs` table) with idempotency keys, retries, dead-letter, in-process worker + CLI worker; `JobDispatcher` interface ready for Trigger.dev / Inngest | `src/server/jobs` |
| Email | `EmailAdapter`: Resend in production, dev mailbox (stored in `email_log`, viewable in the UI) | `src/server/email` |
| AI | `AIProvider` interface: OpenAI (structured outputs via JSON schema) and a deterministic local provider for dev/tests; versioned prompt templates in DB; every call logged in `ai_jobs` | `src/server/ai` |
| Images | sharp: metadata, thumbnails, web/print variants, perceptual hash, quality score | `src/server/media` |
| Publication | Canonical `EditionDocument` → HTML print renderer (Playwright/Chromium PDF) and DOCX renderer (`docx`) | `src/server/publication` |
| Tests | Vitest (unit + integration on a test DB), Playwright (E2E) | `tests/` |

## 2. Code layout

```
src/
  app/                    Next.js routes
    (auth)/login          sign-in
    (newsroom)/           authenticated workbench (sidebar shell)
      overview, editions/[id]/(control-room|inbox|stories|articles|media|layout|qa|exports|contributors)
      stories, articles, media, contributors, campuses, automations, analytics, archive, settings
    contribute/[token]    public tokenised submission form (mobile first)
    api/                  route handlers (uploads, jobs, exports, health, webhooks)
    print/[versionId]     print HTML used by the PDF renderer (server-rendered)
  components/             UI primitives (ui/), newsroom widgets, forms, flatplan, editor
  lib/                    shared pure logic (state machines, scoring, clustering, schemas, utils)
  server/                 server-only modules
    db/ (schema, client, migrate, seed)   auth/   jobs/   ai/   email/   storage/   media/
    campaigns/  editorial/  publication/ (document, templates, pdf, docx, validate)  notifications/  audit/
drizzle/                  SQL migrations
docs/                     Editorial DNA, architecture, runbooks
tests/                    vitest + playwright
```

## 3. Domain model (summary)

Identity & organisation: `users`, `sessions`, `roles` (enum on user), `campuses`,
`academic_programs`, `contributors`, `contributor_groups`, `contributor_group_members`.

Editorial cycle: `editions` (status machine), `edition_sections`, `submission_campaigns`,
`submission_requests` (one per invited contributor, signed token), `submissions`,
`submission_attachments`, `media_assets`, `media_variants`.

Newsroom: `story_clusters`, `story_candidates` (cluster ↔ submission membership), `stories`
(the editorial unit), `articles`, `article_revisions`, `article_sources`, `facts`,
`quotes`, `people`, `organisations`, `events`, `business_deep_dives`, `editorial_decisions`,
`editorial_comments`, `information_requests`.

Publication: `page_plans`, `page_plan_pages`, `publication_versions`, `publication_assets`,
`quality_gate_overrides`.

Platform: `jobs`, `automation_runs`, `ai_jobs`, `prompt_templates`, `notifications`,
`email_log`, `audit_log`, `consent_records`, `system_settings`.

Rules of thumb applied while normalising:

- A **submission** is immutable raw material; editors annotate it (status, cluster) but never
  rewrite it. Every derived artefact points back to submission ids.
- A **story** is the editorial unit (one per cluster once selected). An **article** is the
  written piece for a story; its body is a list of typed blocks and every revision is kept.
- **Facts** and **quotes** carry a source (`submission_id` + optional excerpt) and a
  confidence (`verified_by_submission`, `stated_by_contributor`, `inferred`, `conflicting`).
- **Business Deep Dive** data is a structured satellite of a story, not free text.

## 4. Edition lifecycle

```
UPCOMING → OPEN → REMINDER_1 → REMINDER_2 → GRACE_PERIOD → CLOSED → PROCESSING
→ EDITORIAL_REVIEW → LAYOUT → FINAL_REVIEW → PUBLISHED → ARCHIVED
```

`src/lib/editorial/edition-state.ts` is the single source of truth for allowed transitions.
Campaign dates are per edition (`opensAt`, `reminder1At`, `reminder2At`, `graceEndsAt`,
`publicationTargetAt`). The scheduler (`src/server/campaigns/scheduler.ts`) is idempotent:
each automation step records an `automation_runs` row keyed by `(edition_id, step)` so a
re-run never re-sends emails.

## 5. AI pipeline

Every step is a named service in `src/server/ai/services/*` with a zod output schema and a
prompt template (`prompt_templates`, versioned, editable in Settings). The pipeline runner
(`src/server/ai/pipeline.ts`) executes per submission: normalize → classify → extract
entities → dedupe → cluster; then per cluster: fact sheet → relevance score → missing
information; then per selected story: draft → headline → standfirst → pull quote →
captions → copy edit → consistency/factuality; and per edition: section plan → cover
selection → TOC → page allocation → QA.

Providers: `openai` (structured outputs, model per task from env: `AI_MODEL_FAST`,
`AI_MODEL_STRONG`) and `local` (deterministic, rule-based; never invents facts, used when
`AI_PROVIDER=local` or no key). Each call writes `ai_jobs` (model, prompt version,
latency, tokens, estimated cost, input refs, output, confidence, retry state).

## 6. Publication pipeline

1. `buildEditionDocument(editionId)` assembles the canonical `EditionDocument` from the
   page plan, sections, articles (blocks), media (print variants), quotes, captions and credits.
2. `validateEditionDocument()` runs structural gates (rights, captions, missing media…).
3. PDF: `/print/[versionId]` renders the document with the print design system
   (`src/server/publication/templates/*`, fixed page containers, explicit page numbers and
   running headers). Playwright opens it, runs the pagination script (flows overflowing text
   into continuation pages), measures overflow, then prints to PDF. `pdf-lib` stamps metadata.
   The layout report (overflow, blank pages, missing assets) is stored with the version.
4. DOCX: the same document is rendered with the `docx` library (styles, headers/footers,
   embedded images, captions, page breaks, columns for article bodies).
5. A `publication_versions` row (semver-like label, immutable when published) links both assets.

## 7. Security

Server-side authorization on every action (`requirePermission`), zod validation of all
inputs, signed submission tokens (HMAC, expiring), rate limiting on public endpoints,
MIME sniffing + size limits on uploads, signed asset URLs, no secrets on the client,
audit log for critical actions, RED-rights media blocked at export.
