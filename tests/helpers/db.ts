import { runSeed, type SeedResult } from "@/server/db/seed";

let seeded: SeedResult | null = null;

/** Seeds the test database once per process (the seed truncates everything first). */
export async function ensureSeeded(force = false): Promise<SeedResult> {
  if (!seeded || force) seeded = await runSeed({ quiet: true });
  return seeded;
}
