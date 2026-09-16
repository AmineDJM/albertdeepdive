import "@/server/load-env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/albertdeepdive";
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  console.log(`[migrate] applying migrations to ${url.replace(/:[^:@/]+@/, ":***@")}`);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  console.log("[migrate] done");
  await client.end();
}

main().catch((err) => {
  console.error("[migrate] failed", err);
  process.exit(1);
});
