import { runSeed } from "@/server/db/seed";

/**
 * The journey changes the newsroom as it goes: it launches a campaign, files a contribution,
 * approves an article, renders a version. Re-running it therefore has to start from the seed,
 * or the second run walks into the first one's leftovers.
 *
 * Set E2E_SKIP_SEED=1 to run against the database as it stands.
 */
export default async function globalSetup() {
  if (process.env.E2E_SKIP_SEED === "1") {
    console.log("[e2e] E2E_SKIP_SEED=1 — using the database as it is");
    return;
  }
  const started = Date.now();
  const result = await runSeed({ quiet: true });
  console.log(`[e2e] seeded in ${Math.round((Date.now() - started) / 1000)}s (current edition ${result.editionId})`);
}
