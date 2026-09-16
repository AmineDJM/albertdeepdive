import { env } from "@/server/env";
import { createLogger } from "@/server/logger";
import { processQueue } from "./queue";

const log = createLogger("jobs:runner");

let inflight: Promise<void> | null = null;
let pending = false;

/**
 * In-process job execution. Server actions / route handlers call `kickJobRunner()` after
 * enqueueing; the queue is drained on the next tick (single-flight). In production with
 * JOBS_RUNNER=cli, a dedicated `pnpm worker` process polls instead; a Trigger.dev/Inngest
 * dispatcher can replace this file without touching the rest of the code.
 */
export function kickJobRunner() {
  if (env.JOBS_RUNNER !== "inprocess") return;
  if (inflight) {
    pending = true;
    return;
  }
  inflight = (async () => {
    // Load handlers lazily to avoid import cycles at module evaluation time.
    await import("./handlers");
    try {
      do {
        pending = false;
        await processQueue({ workerId: `inprocess-${process.pid}` });
      } while (pending);
    } catch (err) {
      log.error("runner crashed", { err });
    } finally {
      inflight = null;
    }
  })();
}

/** Await queue completion — used by tests and scripts. */
export async function drainJobs(max = 200) {
  await import("./handlers");
  return processQueue({ workerId: `drain-${process.pid}`, max });
}
