import { beforeAll, describe, expect, it } from "vitest";
import { ensureSeeded } from "../helpers/db";
import { listWorkspaceRows } from "@/server/platform/dashboard";
import { supportRows } from "@/server/platform/support";

/**
 * The comparator that never ran.
 *
 * `lastActivity` comes from `max(created_at)`, and an aggregate arrives as text rather than a Date
 * because drizzle only maps declared columns. Support sorts by it, so the page threw — except
 * while Briefly had exactly one workspace, when a one-element sort never calls its comparator at
 * all. The bug was invisible for as long as there was nobody to compare.
 */
describe("the platform's workspace rows", () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it("gives every workspace a real date or nothing, never a string", async () => {
    const rows = await listWorkspaceRows();
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      if (row.lastActivity !== null) expect(row.lastActivity).toBeInstanceOf(Date);
    }
  });

  it("sorts support without falling over", async () => {
    const rows = await supportRows();
    expect(rows.length).toBeGreaterThan(1);
    // Sorted by trouble, then by how recently something happened.
    for (let i = 1; i < rows.length; i += 1) expect(rows[i - 1].trouble).toBeGreaterThanOrEqual(rows[i].trouble);
  });
});
