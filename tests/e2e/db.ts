import postgres from "postgres";

/**
 * Direct SQL for the end-to-end test. Playwright drives the browser; a handful of steps need a
 * value the UI never shows (a contribution token, an id to navigate to), and reading it from the
 * database is honest — the test still performs every action through the interface.
 */
const sql = postgres(process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/albertdeepdive", { max: 2 });

export async function closeDb() {
  await sql.end({ timeout: 5 });
}

export async function one<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T | null> {
  const rows = await sql.unsafe(query, params as never[]);
  return (rows[0] as T) ?? null;
}

export async function many<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await sql.unsafe(query, params as never[])) as unknown as T[];
}
