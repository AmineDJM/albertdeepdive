import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./identity";
import { editions } from "./editions";

/**
 * What was measured, when, against which version of the standard, and what came of it.
 *
 * Kept rather than computed on demand for three reasons, each of which has cost somebody a week
 * somewhere. An issue that shipped must be explicable later, against the thresholds in force at the
 * time and not today's. A release that makes overflow three times more common is only visible if
 * yesterday's runs are still here to compare with. And a repair only means something beside the
 * measurement that provoked it: 12.4px, reflowed, 0px is a story; "fixed" is not.
 *
 * A run is per edition and per output profile, because the same issue is judged differently on its
 * way to a screen and on its way to a printer, and both answers are true.
 */
export const qcRuns = pgTable(
  "qc_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    /** The output profile this run judged against: PDF_SCREEN, PRINT, EMAIL, WEB… */
    profile: text("profile").notNull(),
    /** The version of the rule catalogue, so a verdict can be read back in its own terms. */
    specVersion: text("spec_version").notNull(),
    /** PASSED | REPAIRED | FAILED | ERRORED */
    status: text("status").notNull(),
    /** The worst severity that survived the repair loop, or null when nothing did. */
    worstSeverity: text("worst_severity"),
    findings: integer("findings").notNull().default(0),
    repaired: integer("repaired").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    /** Which release measured this, so a regression can be attributed. */
    release: text("release"),
    /** Counts per severity, the repair log and anything a check could not run. */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    triggeredById: uuid("triggered_by_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("qc_runs_edition_idx").on(t.editionId, t.profile),
    index("qc_runs_org_idx").on(t.organizationId),
    index("qc_runs_started_idx").on(t.startedAt),
  ],
);

/**
 * One measurement that did not meet its rule, with everything needed to argue about it.
 *
 * Deliberately not a message and a level. A finding carries the metric, what was expected, what was
 * measured, in what unit, against which threshold, where — and, once the repair loop has run, what
 * the measurement became. That last pair is the point of the whole engine: a defect that was
 * repaired is a before and an after, not an adjective.
 */
export const qcFindings = pgTable(
  "qc_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => qcRuns.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    metricId: text("metric_id").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    expected: text("expected").notNull(),
    actual: text("actual").notNull(),
    unit: text("unit").notNull().default(""),
    threshold: text("threshold"),
    /** output, page, entity type, entity id, label, field. */
    location: jsonb("location").$type<Record<string, unknown>>().notNull().default({}),
    repairStrategy: text("repair_strategy"),
    beforeValue: text("before_value"),
    afterValue: text("after_value"),
    repaired: timestamp("repaired_at", { withTimezone: true }),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qc_findings_run_idx").on(t.runId),
    index("qc_findings_metric_idx").on(t.metricId, t.severity),
    index("qc_findings_org_idx").on(t.organizationId),
  ],
);
