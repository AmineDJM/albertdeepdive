import { createLogger } from "@/server/logger";
import type { PublicationKind } from "@/lib/publication/labels";
import type { QcPhase, RenderedArtefact } from "@/server/qc/engine";
import type { Finding } from "@/server/qc/types";

const log = createLogger("publication:preflight");

/**
 * The gate between a rendered file and a file anybody may have.
 *
 * Rendering is not the end of making an artefact; it is the point at which one can finally be
 * measured. So every export goes through here: measure the file that was just made, repair what is
 * arithmetic, measure again with the same code, and only then let it be READY.
 *
 * Two policies, and the difference between them is the whole reason this is not one boolean.
 *
 *   - A defect *of the artefact* — a page that will not parse, a picture whose bytes are gone, text
 *     clipped by its box — stops everything, drafts included. There is nothing useful to review in
 *     a file that does not render, and handing one to a newsroom wastes their afternoon.
 *   - A defect *of the issue* — rights nobody has cleared yet — stops a final or published version
 *     and not a draft. Seeing the proof with the unresolved picture in it is how a newsroom learns
 *     what to clear. Blocking the draft would hide the thing it needs to see.
 *
 * Nothing here is advisory and nothing here can be approved away. An art director cannot sign off a
 * clipped word, and neither can a reviewer who clicked past a warning.
 */

/** Only the artefact's own quality: what the file is, not how the platform is doing. */
const ARTEFACT_CHECKS = ["storage", "imagery", "rights", "geometry", "pdf", "print", "facts"] as const;

/**
 * The profile an exported version is judged against.
 *
 * PDF_SCREEN for every kind, because that is genuinely what the renderer produces: A4 trim, no
 * bleed, screen resolution. Judging a screen PDF against the press profile would fail every page
 * for a bleed the renderer was never asked to draw — a check that is always red is a check nobody
 * reads. A press-bound render will carry the print profile when there is one to carry.
 */
export const VERSION_PROFILE = "PDF_SCREEN";

export type PreflightResult = {
  runId: string | null;
  /** Findings that survived the repair loop and may not ship in a version of this kind. */
  blocking: Finding[];
  /** Everything that survived, blocking or not, worst first. */
  findings: Finding[];
  repaired: number;
  status: string;
};

export async function runPreflight(args: {
  editionId: string;
  versionId: string;
  kind: PublicationKind;
  rendered: RenderedArtefact;
  userId?: string | null;
  onPhase?: (phase: QcPhase) => void | Promise<void>;
  log?: (message: string, level?: "info" | "warn" | "error") => void;
}): Promise<PreflightResult> {
  const { runQc, BLOCKING, HARD_BLOCKING } = await import("@/server/qc");
  const report = await runQc(args.editionId, {
    profile: VERSION_PROFILE,
    only: [...ARTEFACT_CHECKS],
    repair: true,
    rendered: args.rendered,
    versionId: args.versionId,
    triggeredById: args.userId ?? null,
    onPhase: args.onPhase,
  });

  const final = args.kind === "FINAL_REVIEW" || args.kind === "PUBLISHED";
  const stops: readonly string[] = final ? BLOCKING : HARD_BLOCKING;
  const survived = report.findings.filter((finding) => !finding.repaired);
  const blocking = survived.filter((finding) => stops.includes(finding.severity));
  const repaired = report.findings.filter((finding) => finding.repaired).length;

  args.log?.(
    `Preflight ${report.specVersion} against ${VERSION_PROFILE}: ${report.passed.length} passed, ${repaired} repaired, ${survived.length} outstanding, ${blocking.length} blocking`,
    blocking.length ? "error" : "info",
  );
  for (const finding of blocking.slice(0, 10)) {
    args.log?.(`  ${finding.severity} ${finding.metricId}: ${finding.message} (expected ${finding.expected}, measured ${finding.actual})`, "error");
  }
  log.info("preflight", { editionId: args.editionId, versionId: args.versionId, kind: args.kind, status: report.status, blocking: blocking.length, repaired });

  return { runId: report.runId, blocking, findings: survived, repaired, status: report.status };
}
