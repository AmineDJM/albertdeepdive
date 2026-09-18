import postgres from "postgres";

/**
 * Direct SQL for the end-to-end test. Playwright drives the browser; a handful of steps need a
 * value the UI never shows (a contribution token, an id to navigate to), and reading it from the
 * database is honest — the test still performs every action through the interface.
 *
 * One worker runs every spec file, and this module is shared between them, so a spec that closes
 * the connection in its `afterAll` must not leave the next spec with a dead one: the client is
 * made on demand and made again after it has been ended.
 */
const url = process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/albertdeepdive";
let sql: ReturnType<typeof postgres> | null = null;

function client() {
  sql ??= postgres(url, { max: 2 });
  return sql;
}

export async function closeDb() {
  const current = sql;
  sql = null;
  if (current) await current.end({ timeout: 5 });
}

export async function one<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T | null> {
  const rows = await client().unsafe(query, params as never[]);
  return (rows[0] as T) ?? null;
}

export async function many<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  return (await client().unsafe(query, params as never[])) as unknown as T[];
}
