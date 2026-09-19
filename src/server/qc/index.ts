import { registerCheck, registerRepair, runQc, type RunOptions } from "./engine";
import { imageryCheck, rightsCheck, storageCheck } from "./checks/assets";
import { geometryCheck, pdfCheck, printCheck } from "./checks/layout";
import { emailCheck, reconciliationCheck, webCheck } from "./checks/delivery";
import { brandCheck, creativeCheck } from "./checks/creative";
import { analyticsCheck, factsCheck, providersCheck, revisionCheck, stalenessCheck } from "./checks/integrity";
import { applyProviderState, dropIneligibleAsset, reflowOverflow, regenerateVariant, rerenderOutput, resignAssetUrl, swapToValidAsset } from "./repair";
import { editionFingerprint } from "./checks/integrity";
import { BLOCKING, HARD_BLOCKING, type QcReport } from "./types";

/**
 * The engine, assembled.
 *
 * Checks and repairs register here rather than importing each other, so a check can reach the
 * engine's types without the engine reaching back into every check — and so adding one is a single
 * line in a single file rather than a change to the loop.
 */

registerCheck(storageCheck);
registerCheck(imageryCheck);
registerCheck(rightsCheck);
registerCheck(geometryCheck);
registerCheck(pdfCheck);
registerCheck(printCheck);
registerCheck(emailCheck);
registerCheck(webCheck);
registerCheck(factsCheck);
registerCheck(revisionCheck);
registerCheck(stalenessCheck);
registerCheck(analyticsCheck);
registerCheck(providersCheck);
registerCheck(brandCheck);
registerCheck(creativeCheck);
registerCheck(reconciliationCheck);

registerRepair("regenerate-variant", regenerateVariant);
registerRepair("drop-ineligible-asset", dropIneligibleAsset);
registerRepair("swap-to-valid-asset", swapToValidAsset);
registerRepair("reflow-overflow", reflowOverflow);
registerRepair("resign-asset-url", resignAssetUrl);
registerRepair("rerender-output", rerenderOutput);
registerRepair("apply-provider-state", applyProviderState);

export { runQc, editionFingerprint };
export type { QcReport };
export * from "./types";
export * from "./spec";
export * from "./profiles";
export { blocks, blocksHard, registeredChecks } from "./engine";
export type { QcContext, Check, CheckId } from "./engine";

/**
 * The gate. An output with an unresolved blocking finding may never become READY or PUBLISHED.
 *
 * Deliberately a function that throws rather than a boolean somebody might forget to read. The
 * whole engine is worth nothing if the answer it produces is advisory: an art director cannot
 * approve a clipped word, and neither can a caller who did not check.
 */
export class QcBlockedError extends Error {
  readonly code = "QC_BLOCKED";
  constructor(readonly report: QcReport) {
    const blocking = report.findings.filter((finding) => !finding.repaired && BLOCKING.includes(finding.severity));
    super(
      `Preflight found ${blocking.length} thing(s) that must be fixed first:\n` +
        blocking
          .slice(0, 6)
          .map((finding) => `  • [${finding.severity}] ${finding.message} (expected ${finding.expected}, measured ${finding.actual})`)
          .join("\n") +
        (blocking.length > 6 ? `\n  …and ${blocking.length - 6} more.` : ""),
    );
    this.name = "QcBlockedError";
  }
}

/** Run preflight and refuse to go on if anything blocking survived the repair loop. */
export async function requireQcPass(editionId: string, options: RunOptions = {}): Promise<QcReport> {
  const report = await runQc(editionId, options);
  if (!report.ok) throw new QcBlockedError(report);
  return report;
}

/**
 * The same, for a draft artefact: only failures *of the artefact* stop a draft.
 *
 * A newsroom looking at a proof needs to see the issue it has, including the rights it has not
 * cleared yet — that is how it finds out what to clear. What it must never be handed is a file
 * with a page that will not render.
 */
export async function requireRenderable(editionId: string, options: RunOptions = {}): Promise<QcReport> {
  const report = await runQc(editionId, options);
  const hard = report.findings.filter((finding) => !finding.repaired && HARD_BLOCKING.includes(finding.severity));
  if (hard.length) throw new QcBlockedError({ ...report, findings: hard });
  return report;
}
