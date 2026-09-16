import "@/server/load-env";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { runSeed } from "@/server/db/seed";

/**
 * Seeds only an empty database.
 *
 * The deploy command runs on every release, and the seed truncates everything it touches. This
 * guard is what makes it safe to leave in the pipeline: once a newsroom has its own editions,
 * redeploying never touches them.
 */
async function main() {
  const [{ count }] = await db.execute<{ count: number }>(sql`select count(*)::int as count from editions`);
  if (Number(count) > 0) {
    console.log(`[seed:once] ${count} edition(s) already exist — leaving the database alone.`);
    return;
  }
  console.log("[seed:once] empty database — loading the demo issue.");
  const result = await runSeed({ quiet: true });
  console.log(`[seed:once] done. Sign in as ${result.adminEmail}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // A failed seed must not block a deployment that is otherwise fine.
    console.error("[seed:once] failed:", err instanceof Error ? err.message : err);
    process.exit(0);
  });
