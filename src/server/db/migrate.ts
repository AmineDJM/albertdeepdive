import "@/server/load-env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

/** Applies the SQL migrations in `drizzle/`. Reusable so the deploy step can chain it in-process. */
export async function runMigrations() {
  const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/albertdeepdive";
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  console.log(`[migrate] applying migrations to ${url.replace(/:[^:@/]+@/, ":***@")}`);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  /*
   * Titles made before contributors had a public door get one now.
   *
   * The same handle as the subscribe link: a newsletter is one thing, and asking somebody to
   * remember two unrelated strings for the two halves of it would be a worse answer than none.
   * It runs while this connection is still open, which the plan seeding below does not need.
   */
  const opened = await client`update publications set join_slug = subscribe_slug where join_slug is null and subscribe_slug is not null`;
  if (opened.count) console.log(`[migrate] opened the contributor link on ${opened.count} title(s)`);
  await client.end();

  // The plans Briefly sells are defined in code and seeded here rather than written into a
  // migration, so that there is one source of truth and editing a price in the console is not
  // undone by the next deploy. Both steps only create what is missing.
  const { ensureDefaultPlans, backfillSubscriptions, backfillPlanEntitlements, correctRevisionAllowances } = await import("@/server/billing/plans");
  const created = await ensureDefaultPlans();
  const attached = await backfillSubscriptions();
  const taught = await backfillPlanEntitlements();
  const corrected = await correctRevisionAllowances();
  if (created.length) console.log(`[migrate] seeded ${created.length} plan(s)`);
  if (taught.length) console.log(`[migrate] added new entitlements to existing plans: ${taught.join("; ")}`);
  if (corrected.length) console.log(`[migrate] corrected revision allowances: ${corrected.join("; ")}`);
  if (attached) console.log(`[migrate] put ${attached} workspace(s) on the default plan`);

  console.log("[migrate] done");
}

// Allow running this file directly (pnpm db:migrate).
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  runMigrations().catch((err) => {
    console.error("[migrate] failed", err);
    process.exit(1);
  });
}
