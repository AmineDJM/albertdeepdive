/**
 * Whether a seed is allowed to empty the database it is pointed at.
 *
 * The seed's first act is `TRUNCATE ... CASCADE` over every table, which is right for a machine
 * you are developing on and catastrophic anywhere else. It was guarded by `NODE_ENV`, and that
 * guard asks the wrong question: it establishes whether *this process* is a production process,
 * when what matters is whether *this database* is a production database. A test run on a laptop is
 * `NODE_ENV=test` no matter which host `DATABASE_URL` names, so a deployment environment that
 * exports a live `DATABASE_URL` — and `dotenv` will not override a real environment variable with
 * the `.env` one — walks straight past it. That is not hypothetical: this suite's own seed issued
 * a full truncate against a hosted database and was stopped by a connection timeout rather than by
 * anything in the code.
 *
 * So the question is asked of the address instead. A database on this machine may be emptied; one
 * reachable over the network may not, unless somebody says `FORCE_SEED=1` and means it.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** Does this connection string point at a database on this machine? */
export function isLocalDatabase(url: string): boolean {
  let hostname: string;
  try {
    // A Unix-socket connection has no host at all, and is by definition on this machine.
    if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
      hostname = new URL(url).hostname;
    } else {
      return false;
    }
  } catch {
    return false;
  }
  if (!hostname) return true;
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

/** The address with its password removed, safe to print. */
export function redactDatabaseUrl(url: string): string {
  return url.replace(/:[^:@/]+@/, ":***@");
}

/**
 * Throws unless emptying this database is allowed. `FORCE_SEED=1` is the deliberate override, and
 * it has to be deliberate: nothing sets it by default and no script passes it.
 */
export function assertSeedable(url: string, nodeEnv: string, force: string | undefined): void {
  if (force === "1") return;
  if (nodeEnv === "production") {
    throw new Error("Refusing to seed a production database without FORCE_SEED=1");
  }
  if (!isLocalDatabase(url)) {
    throw new Error(
      `Refusing to empty a database that is not on this machine: ${redactDatabaseUrl(url)}. ` +
        `The seed truncates every table. Point DATABASE_URL at a local database, or set FORCE_SEED=1 if you really mean this one.`,
    );
  }
}
