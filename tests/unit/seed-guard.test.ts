import { describe, expect, it } from "vitest";
import { assertSeedable, isLocalDatabase, redactDatabaseUrl } from "@/server/db/seed-guard";

/**
 * The seed truncates every table before it writes anything, so the only question that matters is
 * which database it is pointed at. This is the regression for a near miss: a deployment
 * environment exported a live `DATABASE_URL`, `dotenv` left it alone because it will not override
 * a real environment variable, and the end-to-end suite's seed issued `TRUNCATE ... CASCADE` over
 * eighty-four tables of a hosted database. A connection timeout is what stopped it.
 */
describe("what the seed is allowed to empty", () => {
  it("knows a database on this machine", () => {
    for (const url of [
      "postgres://postgres@127.0.0.1:5432/albertdeepdive",
      "postgres://postgres:pw@localhost:5432/albertdeepdive_test",
      "postgresql://user:pw@[::1]:5432/db",
    ]) {
      expect(isLocalDatabase(url), url).toBe(true);
    }
  });

  it("knows one that is not", () => {
    for (const url of [
      "postgres://user:pw@dpg-abc123-a.oregon-postgres.render.com:5432/briefly",
      "postgres://user:pw@db.supabase.co:5432/postgres",
      "postgres://user:pw@10.0.0.4:5432/postgres",
      "postgres://user:pw@localhost.evil.example.com:5432/postgres",
    ]) {
      expect(isLocalDatabase(url), url).toBe(false);
    }
  });

  it("refuses a hosted database even when the process is not a production one", () => {
    // The old guard asked NODE_ENV, which is "test" here, and so let this through.
    expect(() => assertSeedable("postgres://u:pw@dpg-x.oregon-postgres.render.com:5432/briefly", "test", undefined)).toThrow(/not on this machine/);
    expect(() => assertSeedable("postgres://u:pw@dpg-x.oregon-postgres.render.com:5432/briefly", "development", undefined)).toThrow(/not on this machine/);
  });

  it("keeps the production refusal it already had", () => {
    expect(() => assertSeedable("postgres://postgres@127.0.0.1:5432/albertdeepdive", "production", undefined)).toThrow(/production database/);
  });

  it("lets a local database through, and an explicit override through anywhere", () => {
    expect(() => assertSeedable("postgres://postgres@127.0.0.1:5432/albertdeepdive", "test", undefined)).not.toThrow();
    expect(() => assertSeedable("postgres://u:pw@dpg-x.oregon-postgres.render.com:5432/briefly", "production", "1")).not.toThrow();
  });

  it("never prints the password in the refusal", () => {
    const url = "postgres://briefly:s3cr3t-do-not-print@dpg-x.oregon-postgres.render.com:5432/briefly";
    expect(redactDatabaseUrl(url)).not.toContain("s3cr3t-do-not-print");
    try {
      assertSeedable(url, "test", undefined);
      throw new Error("should have refused");
    } catch (err) {
      expect(String(err)).not.toContain("s3cr3t-do-not-print");
      expect(String(err)).toContain("oregon-postgres.render.com");
    }
  });
});
