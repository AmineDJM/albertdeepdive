import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * The end-to-end suite against the built app, rather than against `next dev`.
 *
 * `next dev` compiles each route the first time a test opens it, which on a machine also running
 * Chromium turned the suite into ninety minutes of compilation and, eventually, a dev server that
 * stopped answering: every spec after it failed on `goto("/login")` with nothing wrong in the
 * product. The same suite against a build takes about seven minutes, and it is what the deployment
 * actually runs.
 *
 * Two things the build needs to be told, because production means them:
 *
 *   - `STORAGE_ALLOW_LOCAL_DURABLE`, since renders write PDFs and this machine has no bucket. The
 *     guard is right to refuse by default; here the disk is the scratch directory on purpose.
 *   - `E2E_BASE_URL`, which tells the Playwright config to use this server instead of starting a
 *     dev one of its own.
 *
 * Usage: `pnpm build:webpack && pnpm test:e2e:built [-- <playwright args>]`
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/login`, { redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function main() {
  const server = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      PORT: String(PORT),
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? BASE,
      STORAGE_ALLOW_LOCAL_DURABLE: process.env.STORAGE_ALLOW_LOCAL_DURABLE ?? "1",
    },
  });
  const stop = () => {
    if (!server.killed) server.kill("SIGTERM");
  };
  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  const deadline = Date.now() + 180_000;
  while (!(await reachable())) {
    if (server.exitCode !== null) throw new Error(`the server exited with ${server.exitCode} before it answered`);
    if (Date.now() > deadline) throw new Error(`${BASE} did not answer within three minutes`);
    await delay(1000);
  }
  console.log(`[e2e] ${BASE} is up — running the suite against the build`);

  const code = await new Promise<number>((resolve) => {
    const tests = spawn("node_modules/.bin/playwright", ["test", ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, E2E_BASE_URL: BASE },
    });
    tests.on("exit", (status) => resolve(status ?? 1));
  });
  stop();
  process.exit(code);
}

main().catch((err) => {
  console.error("[e2e]", err instanceof Error ? err.message : err);
  process.exit(1);
});
