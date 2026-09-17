import "@/server/load-env";
import { sql } from "drizzle-orm";
import { runMigrations } from "@/server/db/migrate";
import { db } from "@/server/db/client";
import { runSeed } from "@/server/db/seed";

/**
 * The one command a deploy runs before the new version goes live: bring the schema up to date,
 * then load the demo issue into a database that has none yet.
 *
 * It is a single process on purpose. A hosting platform that runs `pnpm a && pnpm b` without a
 * shell passes `&& pnpm b` as arguments to `pnpm a`, so the two never chain; folding both steps in
 * here removes that trap. Migrations must succeed — a schema that failed to apply is not safe to
 * serve — but the seed never blocks a deploy, since an established newsroom does not want it.
 */
async function main() {
  await runMigrations();

  try {
    const [{ count }] = await db.execute<{ count: number }>(sql`select count(*)::int as count from editions`);
    if (Number(count) > 0) {
      console.log(`[predeploy] ${count} edition(s) already exist — leaving the data alone.`);
      return;
    }
    console.log("[predeploy] empty database — loading the demo issue.");
    const result = await runSeed({ quiet: true });
    console.log(`[predeploy] demo issue loaded. Sign in as ${result.adminEmail}.`);
  } catch (err) {
    console.error("[predeploy] seeding skipped:", err instanceof Error ? err.message : err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[predeploy] migration failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
