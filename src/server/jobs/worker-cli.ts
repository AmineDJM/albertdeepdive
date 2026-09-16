import "@/server/load-env";
/* Dedicated worker process: `pnpm worker`. Polls the jobs table and runs the automation tick. */
import { env } from "@/server/env";
import { createLogger } from "@/server/logger";
import { processQueue, recoverStaleJobs } from "./queue";

const log = createLogger("worker");

async function main() {
  await import("./handlers");
  const workerId = `worker-${process.pid}`;
  log.info("worker started", { workerId, pollMs: env.JOBS_POLL_INTERVAL_MS });
  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));
  let lastTick = 0;
  while (!stopping) {
    try {
      await recoverStaleJobs();
      const n = await processQueue({ workerId, max: 20 });
      if (Date.now() - lastTick > 60_000) {
        lastTick = Date.now();
        const { runAutomationTick } = await import("@/server/campaigns/scheduler");
        await runAutomationTick({ triggeredBy: "SCHEDULER" });
      }
      if (n === 0) await new Promise((r) => setTimeout(r, env.JOBS_POLL_INTERVAL_MS));
    } catch (err) {
      log.error("worker loop error", { err });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  log.info("worker stopped");
  process.exit(0);
}

main();
