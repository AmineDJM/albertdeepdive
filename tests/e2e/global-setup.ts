import { execFileSync } from "node:child_process";

/**
 * The journey changes the newsroom as it goes: it launches a campaign, files a contribution,
 * approves an article, renders a version. Re-running it therefore has to start from the seed, or the
 * second run walks into the first one's leftovers.
 *
 * Run as a subprocess rather than imported.
 *
 * Importing `runSeed` looked tidier and meant the whole end-to-end suite could not start: Playwright
 * transforms the files it owns, but the app's own modules are then required by Node, which knows
 * nothing about the `@/` alias — so the import chain died several files deep with `Cannot find
 * module '@/server/db/client'`, before a single test ran. The seed already has a command-line entry
 * that the rest of the project uses; calling it is both simpler and the same code path everybody
 * else exercises.
 *
 * Set E2E_SKIP_SEED=1 to run against the database as it stands.
 */
export default async function globalSetup() {
  if (process.env.E2E_SKIP_SEED === "1") {
    console.log("[e2e] E2E_SKIP_SEED=1 — using the database as it is");
    return;
  }
  const started = Date.now();
  execFileSync("pnpm", ["exec", "tsx", "src/server/db/seed-cli.ts"], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, LOG_LEVEL: process.env.LOG_LEVEL ?? "error" },
  });
  console.log(`[e2e] seeded in ${Math.round((Date.now() - started) / 1000)}s`);
}
