import "@/server/load-env";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/albertdeepdive";
  if (process.env.NODE_ENV === "production" && process.env.FORCE_RESET !== "1") {
    throw new Error("Refusing to reset a production database without FORCE_RESET=1");
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  console.log("[reset] dropping public schema");
  await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
  await client.end();
  console.log("[reset] done — run `pnpm db:migrate && pnpm db:seed`");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
