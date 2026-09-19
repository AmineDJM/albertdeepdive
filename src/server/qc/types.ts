/**
 * What a quality check produces, and what it is allowed to say.
 *
 * The shape is the argument. A check does not return "looks wrong" or a score out of ten; it
 * returns a measurement, the threshold it was compared against, where it was taken and what could
 * be done about it. That is what makes a failure arguable with evidence rather than with taste, and
 * it is why an AI creative director cannot overrule one: there is nothing to have an opinion about
 * in "the headline box is 2.4px taller than the space it was given on page 7".
 */

/**
 * How bad, and what it stops.
 *
 * INFO and WARNING never block. FAIL blocks a publish but not a draft export, so a newsroom can
 * still look at what it has. HARD_FAIL and CRITICAL_FAIL block everything downstream: the first is
 * a defect in the issue, the second is a defect in the artefact itself — a PDF page that will not
 * render is not a page anybody can fix by editing copy.
 */
export type Severity = "INFO" | "WARNING" | "FAIL" | "HARD_FAIL" | "CRITICAL_FAIL";

export const SEVERITY_ORDER: Record<Severity, number> = {
  INFO: 0,
  WARNING: 1,
  FAIL: 2,
  HARD_FAIL: 3,
  CRITICAL_FAIL: 4,
};

/** Severities that may never reach READY or PUBLISHED, whatever anybody thinks of the page. */
export const BLOCKING: readonly Severity[] = ["FAIL", "HARD_FAIL", "CRITICAL_FAIL"];

/** Severities that block even a draft artefact, because the artefact itself is broken. */
export const HARD_BLOCKING: readonly Severity[] = ["HARD_FAIL", "CRITICAL_FAIL"];

export function worst(severities: Severity[]): Severity | null {
  return severities.reduce<Severity | null>((top, s) => (top === null || SEVERITY_ORDER[s] > SEVERITY_ORDER[top] ? s : top), null);
}

/**
 * Where a number came from, so nobody has to guess whether it is a law or a preference.
 *
 * This exists because "300 PPI" gets quoted as though it were physics. It is a common commercial
 * print requirement, not a constant, and a printer who asks for 240 is not wrong. A threshold whose
 * origin is written down can be argued with; one without an origin gets copied forever.
 */
export type ThresholdOrigin = "INDUSTRY_STANDARD" | "OUTPUT_PROVIDER_REQUIREMENT" | "BRIEFLY_HOUSE_STANDARD";

/** What a check measures, and what it is measured in. */
export type MetricUnit = "px" | "mm" | "ppi" | "count" | "ratio" | "bytes" | "words" | "seconds" | "deltaE" | "boolean" | "hash" | "";

/**
 * One rule, versioned with the rest of the catalogue.
 *
 * `failureThreshold` is the number the measurement is compared against; `severity` is what crossing
 * it means. A rule with no thresholds is a predicate — it either holds or it does not — and says so
 * with `boolean`.
 */
export type MetricSpec = {
  id: string;
  title: string;
  /** In words: what is actually measured, so a reader can reproduce it. */
  method: string;
  unit: MetricUnit;
  target?: number | string;
  warningThreshold?: number;
  failureThreshold?: number;
  severity: Severity;
  /** The repair that may be attempted, or null when a person has to decide. */
  repair: RepairStrategy | null;
  origin: ThresholdOrigin;
  reference?: string;
};

/**
 * A repair that can be attempted deterministically, named rather than described.
 *
 * Every one of these is local: none regenerates an issue to fix one page, because regenerating an
 * issue changes a hundred things to fix one and makes the remeasure meaningless.
 */
export type RepairStrategy =
  | "reflow-overflow"
  | "regenerate-variant"
  | "swap-to-valid-asset"
  | "drop-ineligible-asset"
  | "rerender-output"
  | "resign-asset-url"
  | "apply-provider-state"
  | "remeasure-only";

export type FindingLocation = {
  output?: string;
  page?: number;
  entityType?: "article" | "story" | "media" | "page" | "edition" | "output" | "link" | "workspace" | "provider";
  entityId?: string;
  entityLabel?: string;
  field?: string;
};

/**
 * One measurement that did not meet its rule.
 *
 * `expected`, `actual`, `unit` and `threshold` are the evidence; `beforeValue` and `afterValue`
 * are what the repair loop writes, so a finding carries its own history: this was 12.4, we
 * reflowed, it is now 0.
 */
export type Finding = {
  metricId: string;
  severity: Severity;
  message: string;
  expected: string;
  actual: string;
  unit: MetricUnit;
  threshold: string | null;
  location: FindingLocation;
  repairStrategy: RepairStrategy | null;
  beforeValue: number | string | null;
  afterValue: number | string | null;
  repaired: boolean;
  /** Anything else a person would want when reading this in three weeks. */
  evidence?: Record<string, unknown>;
};

/** A measurement that passed, kept so a report can prove a check ran rather than merely not failing. */
export type Passed = {
  metricId: string;
  actual: string;
  unit: MetricUnit;
  location?: FindingLocation;
};

export type CheckResult = { findings: Finding[]; passed: Passed[] };

export const nothing = (): CheckResult => ({ findings: [], passed: [] });

/** The states an output moves through. READY is reachable only from a clean preflight. */
export type QcStatus = "PASSED" | "REPAIRED" | "FAILED" | "ERRORED";

export type QcReport = {
  runId: string | null;
  editionId: string;
  organizationId: string | null;
  profile: string;
  specVersion: string;
  status: QcStatus;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  findings: Finding[];
  passed: Passed[];
  /** Repairs attempted, in order, with what each one changed. */
  repairs: RepairOutcome[];
  counts: Record<Severity, number>;
  /** True when nothing blocking survives — the only way to READY. */
  ok: boolean;
  /** Checks that could not run at all, which is not the same as a check that passed. */
  skipped: { check: string; reason: string }[];
};

export type RepairOutcome = {
  strategy: RepairStrategy;
  metricId: string;
  location: FindingLocation;
  attempted: true;
  succeeded: boolean;
  before: number | string | null;
  after: number | string | null;
  detail: string;
};

/** A helper so a check reads as a comparison rather than as a pile of object literals. */
export function compare(args: {
  spec: MetricSpec;
  actual: number;
  /** Defaults to "the measurement must not exceed the threshold". */
  direction?: "at-most" | "at-least";
  location: FindingLocation;
  message: string;
  expectedText?: string;
  evidence?: Record<string, unknown>;
}): CheckResult {
  const { spec, actual, location, message } = args;
  const direction = args.direction ?? "at-most";
  const fail = spec.failureThreshold;
  const warn = spec.warningThreshold;
  const over = (limit: number) => (direction === "at-most" ? actual > limit : actual < limit);

  const expected =
    args.expectedText ??
    (fail === undefined ? String(spec.target ?? "") : `${direction === "at-most" ? "≤" : "≥"} ${fail}${spec.unit ? ` ${spec.unit}` : ""}`);

  if (fail !== undefined && over(fail)) {
    return {
      findings: [
        {
          metricId: spec.id,
          severity: spec.severity,
          message,
          expected,
          actual: `${round(actual)}${spec.unit ? ` ${spec.unit}` : ""}`,
          unit: spec.unit,
          threshold: `${fail}`,
          location,
          repairStrategy: spec.repair,
          beforeValue: round(actual),
          afterValue: null,
          repaired: false,
          evidence: args.evidence,
        },
      ],
      passed: [],
    };
  }
  if (warn !== undefined && over(warn)) {
    return {
      findings: [
        {
          metricId: spec.id,
          severity: "WARNING",
          message,
          expected,
          actual: `${round(actual)}${spec.unit ? ` ${spec.unit}` : ""}`,
          unit: spec.unit,
          threshold: `${warn}`,
          location,
          repairStrategy: spec.repair,
          beforeValue: round(actual),
          afterValue: null,
          repaired: false,
          evidence: args.evidence,
        },
      ],
      passed: [],
    };
  }
  return { findings: [], passed: [{ metricId: spec.id, actual: `${round(actual)}${spec.unit ? ` ${spec.unit}` : ""}`, unit: spec.unit, location }] };
}

/** A predicate rule: it holds or it does not, and there is no threshold to quote. */
export function assertThat(args: {
  spec: MetricSpec;
  holds: boolean;
  location: FindingLocation;
  message: string;
  expected?: string;
  actual?: string;
  evidence?: Record<string, unknown>;
}): CheckResult {
  if (args.holds) {
    return { findings: [], passed: [{ metricId: args.spec.id, actual: args.actual ?? "ok", unit: args.spec.unit, location: args.location }] };
  }
  return {
    findings: [
      {
        metricId: args.spec.id,
        severity: args.spec.severity,
        message: args.message,
        expected: args.expected ?? String(args.spec.target ?? "true"),
        actual: args.actual ?? "false",
        unit: args.spec.unit,
        threshold: null,
        location: args.location,
        repairStrategy: args.spec.repair,
        beforeValue: args.actual ?? null,
        afterValue: null,
        repaired: false,
        evidence: args.evidence,
      },
    ],
    passed: [],
  };
}

export function merge(...results: CheckResult[]): CheckResult {
  return {
    findings: results.flatMap((r) => r.findings),
    passed: results.flatMap((r) => r.passed),
  };
}

const round = (value: number): number => (Number.isInteger(value) ? value : Math.round(value * 100) / 100);
