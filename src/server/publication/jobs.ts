import { JOB_TYPES, registerJobHandler } from "@/server/jobs/registry";
import { renderVersion } from "./versions";

/**
 * EDITION_EXPORT job: renders a publication version (PDF + DOCX) with progress reporting.
 * Payload: { versionId }. Validation failures are recorded on the version (status FAILED) and do not
 * fail the job; unexpected render errors do, so the queue can retry.
 */
registerJobHandler<{ versionId: string }, { versionId: string; label: string; status: string }>(
  JOB_TYPES.EDITION_EXPORT,
  async (payload, ctx) => {
    if (!payload.versionId) throw new Error("EDITION_EXPORT payload requires versionId");
    const version = await renderVersion(payload.versionId, { jobCtx: ctx });
    return { versionId: version.id, label: version.label, status: version.status };
  },
);
