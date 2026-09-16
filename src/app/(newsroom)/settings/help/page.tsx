import Link from "next/link";
import { Bot, CalendarDays, CheckCircle2, FileOutput, ShieldCheck, Users, Workflow } from "lucide-react";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from "@/lib/auth/permissions";

const TOC = [
  { id: "cycle", label: "The monthly cycle", icon: CalendarDays },
  { id: "roles", label: "Roles", icon: Users },
  { id: "ai", label: "The AI principle", icon: Bot },
  { id: "gates", label: "Quality gates", icon: CheckCircle2 },
  { id: "exports", label: "Exports & publication", icon: FileOutput },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "privacy", label: "Privacy", icon: ShieldCheck },
];

const CYCLE = [
  { day: "Day 1", title: "Contribution request", text: "Every invited contributor receives a personal, signed link. No account, no password — the link is the identity. The form works on a phone in two minutes: what happened, who was involved, why it matters, photos." },
  { day: "Day 4", title: "Reminder #1", text: "Only to those who have not submitted. Friendly, with the number of days left." },
  { day: "Day 7", title: "Reminder #2 · deadline 23:59", text: "Last call. Late entries are still accepted during the grace day." },
  { day: "Day 8", title: "Grace period ends · campaign closes", text: "The inbox freezes. AI processing starts within minutes: every submission is normalised, classified, its people and organisations extracted, duplicates flagged, and related submissions grouped into story clusters with a fact sheet." },
  { day: "Day 8–11", title: "Editorial review, writing, layout", text: "Editors confirm clusters into stories, choose what runs, request missing information from contributors, let the AI draft from the verified fact sheet, then rewrite, fact-check and approve. The flatplan allocates pages by section." },
  { day: "Day 11", title: "Final review", text: "The editor in chief reviews the assembled issue: quality gates, cover, table of contents, captions and credits." },
  { day: "Day 15", title: "Publication", text: "One canonical edition document is rendered to PDF (print) and DOCX (editable) — same content, same page numbers. The edition is published, then archived." },
];

const GATES = [
  { name: "Sources on every fact", text: "Every paragraph an AI wrote cites the fact ids it relied on, and every fact points back to a submission. A story without a source is not a story." },
  { name: "Image rights", text: "Photos are GREEN (cleared), YELLOW (unclear) or RED (do not publish). RED never exports; YELLOW blocks final approval unless an editor overrides with a reason." },
  { name: "Captions and credits", text: "Every published image carries a caption and a © credit, as the reference issue did." },
  { name: "Consistency", text: "Names, companies, dates and figures are checked across the whole issue (Volvo, not Volco). Discrepancies are flagged, never silently changed." },
  { name: "Layout", text: "No overflowing text, no blank pages, no missing assets, a table of contents generated from the actual page plan." },
  { name: "Human approval", text: "Articles are approved by an editor; the edition is approved by the editor in chief. Overrides are recorded with a reason in the audit log." },
];

export default function HelpPage() {
  return (
    <>
      <PageHeader title="How the newsroom works" description="A five-minute tour of Albert Deep Dive for editors, campus editors and administrators." />
      <PageBody>
        <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="lg:sticky lg:top-16 lg:self-start">
            <div className="label-caps mb-2">On this page</div>
            <ul className="space-y-1">
              {TOC.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground">
                    <t.icon className="size-3.5" /> {t.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <article className="prose-albert max-w-3xl space-y-10">
            <header className="border-b border-border pb-6">
              <p className="masthead text-[26px] leading-tight font-semibold tracking-tight">Raw human information in, a verified newspaper out.</p>
              <p className="mt-3 text-[14px] leading-6 text-muted-foreground">
                Albert&rsquo;s Deep Dive is the monthly, student-run newspaper of Albert School. This system collects what happened on every campus, turns it into verified story clusters, helps editors write, lays the issue out deterministically and exports the same edition to PDF and DOCX. The pipeline is automated; the judgement is human.
              </p>
              <p className="mt-3 font-mono text-2xs tracking-wide text-muted-foreground uppercase">raw information → structured sources → verified facts → story clusters → editorial selection → AI-assisted writing → human review → layout → QA → publication</p>
            </header>

            <section id="cycle" className="scroll-mt-16 space-y-4">
              <h2 className="font-display text-[20px] font-semibold tracking-tight">The monthly cycle</h2>
              <p className="text-[13.5px] leading-6">Each edition follows the same rhythm, driven by the campaign dates of the edition (defaults live in <Link href="/settings/system#campaign" className="text-brand hover:underline">System settings</Link>). The days below are the defaults; every edition can shift them.</p>
              <ol className="relative space-y-4 border-l border-border pl-5">
                {CYCLE.map((step) => (
                  <li key={step.day} className="relative">
                    <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-brand bg-card" aria-hidden />
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="tabular font-mono text-2xs text-muted-foreground uppercase">{step.day}</span>
                      <span className="text-[13.5px] font-semibold">{step.title}</span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{step.text}</p>
                  </li>
                ))}
              </ol>
              <p className="text-[13px] leading-5 text-muted-foreground">The edition status follows the cycle: Upcoming → Open → Reminder 1 → Reminder 2 → Grace period → Closed → AI processing → Editorial review → Layout → Final review → Published → Archived. The control room of each edition shows where it stands and what is blocking the next step.</p>
            </section>

            <section id="roles" className="scroll-mt-16 space-y-4">
              <h2 className="font-display text-[20px] font-semibold tracking-tight">Roles</h2>
              <p className="text-[13.5px] leading-6">Contributors never log in — they receive links. Everyone else has one of six roles; permissions are enforced on the server for every action. The full matrix is in <Link href="/settings/users" className="text-brand hover:underline">Users &amp; roles</Link>.</p>
              <dl className="grid gap-2 sm:grid-cols-2">
                {ROLES.map((r) => (
                  <div key={r} className="rounded-lg border border-border bg-card px-3 py-2.5">
                    <dt className="text-[13px] font-semibold">{ROLE_LABELS[r]}</dt>
                    <dd className="mt-0.5 text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section id="ai" className="scroll-mt-16 space-y-4">
              <h2 className="font-display text-[20px] font-semibold tracking-tight">The AI principle: human sources remain the ground truth</h2>
              <blockquote className="border-l-2 border-brand pl-4 font-serif text-[16px] leading-7 text-foreground">The AI never invents a person, a date, a result, a company, a figure or a quotation. If something is missing, it says so — and the newsroom asks the contributor.</blockquote>
              <ul className="space-y-2 text-[13.5px] leading-6">
                <li><strong>Submissions are immutable.</strong> Raw material is never rewritten; editors annotate it. Every derived artefact keeps the submission ids it came from.</li>
                <li><strong>Facts carry a confidence.</strong> <Badge variant="success">Verified by submission</Badge> when two sources agree or the source is first-hand, <Badge variant="info">Stated by contributor</Badge> otherwise, <Badge variant="destructive">Conflicting</Badge> when sources disagree — those are surfaced, never resolved by the model.</li>
                <li><strong>Drafts are traceable.</strong> Each paragraph cites its facts; unused facts and cautions are returned to the editor. The manual edit ratio after the AI draft is measured and shown in Analytics.</li>
                <li><strong>Every call is logged.</strong> Model, prompt version, tokens, cost, latency and output are in the <Link href="/settings/jobs?tab=ai" className="text-brand hover:underline">AI trace</Link>. Prompts are versioned in <Link href="/settings/prompts" className="text-brand hover:underline">Prompts</Link>; changing one never changes past outputs.</li>
                <li><strong>Deterministic fallback.</strong> Without an API key the local provider runs rule-based versions of every step, so the newsroom always works and tests are reproducible.</li>
              </ul>
            </section>

            <section id="gates" className="scroll-mt-16 space-y-4">
              <h2 className="font-display text-[20px] font-semibold tracking-tight">Quality gates</h2>
              <p className="text-[13.5px] leading-6">An edition cannot move to final review or publication while a gate fails. Gates are checked continuously in the QA tab; overrides need a reason and a name.</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {GATES.map((g) => (
                  <li key={g.name} className="rounded-lg border border-border bg-card px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold"><CheckCircle2 className="size-3.5 text-success" /> {g.name}</div>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{g.text}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section id="exports" className="scroll-mt-16 space-y-4">
              <h2 className="font-display text-[20px] font-semibold tracking-tight">Exports &amp; publication</h2>
              <p className="text-[13.5px] leading-6">The page plan, sections, approved articles, print variants of the media, quotes, captions and credits are assembled into one canonical edition document. That document is rendered twice: to <strong>PDF</strong> through the print design system (fixed page containers, explicit page numbers, running header <em>issue label · page · month</em>) and to <strong>DOCX</strong> with real styles, headers, footers and embedded images. Both come from the same source, so they never drift.</p>
              <p className="text-[13.5px] leading-6">Every export is a numbered publication version (v0.1, v0.2, … v1.0). Draft versions can be regenerated; a published version is immutable. The <Link href="/archive" className="text-brand hover:underline">Archive</Link> keeps every published issue with its downloads and makes every story, person and company searchable.</p>
              <p className="text-[13.5px] leading-6">Page size is a setting (A4 by default so any campus printer can print it; tabloid for the newspaper feel). The layout is deterministic: the same plan always produces the same pages.</p>
            </section>

            <section id="automations" className="scroll-mt-16 space-y-4">
              <h2 className="font-display text-[20px] font-semibold tracking-tight">Automations</h2>
              <p className="text-[13.5px] leading-6">A scheduler tick runs the monthly steps: it creates next month&rsquo;s edition, opens campaigns, sends reminders, closes, launches processing, checks campus coverage and alerts before deadlines. Every step is idempotent — it is recorded once per edition, so a tick can run every few minutes without sending anything twice. Steps can be switched off individually in <Link href="/automations" className="text-brand hover:underline">Automations</Link>, and run by hand with <em>Run automations now</em>. External schedulers call <code className="rounded bg-muted px-1 font-mono text-xs">POST /api/automations/tick</code> with the <code className="rounded bg-muted px-1 font-mono text-xs">AUTOMATION_TICK_TOKEN</code>.</p>
              <p className="text-[13.5px] leading-6">Long tasks (processing, drafting, rendering) run as jobs in a database-backed queue with retries and a dead-letter state; you can watch, retry and cancel them in <Link href="/settings/jobs" className="text-brand hover:underline">Jobs &amp; AI trace</Link>. Emails are visible in the <Link href="/settings/mailbox" className="text-brand hover:underline">Mailbox</Link> — in development they are stored instead of sent.</p>
            </section>

            <section id="privacy" className="scroll-mt-16 space-y-4">
              <h2 className="font-display text-[20px] font-semibold tracking-tight">Privacy</h2>
              <p className="text-[13.5px] leading-6">Contributors consent to publication and confirm image rights when they submit; each consent is stored with the text version they saw. Personal data is exportable and can be anonymised on request while the editorial record stays intact. Critical actions are written to the <Link href="/settings/audit" className="text-brand hover:underline">audit log</Link>. See <Link href="/settings/privacy" className="text-brand hover:underline">Privacy &amp; retention</Link>.</p>
            </section>

            <footer className="border-t border-border pt-4 text-2xs text-muted-foreground">Albert Deep Dive · the automated monthly newsroom of Albert School. Editorial DNA and architecture are documented in the repository (docs/).</footer>
          </article>
        </div>
      </PageBody>
    </>
  );
}
