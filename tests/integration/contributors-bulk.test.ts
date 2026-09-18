import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createContributor, deleteContributors, listContributors, setContributorsActive } from "@/server/contributors/service";

/**
 * Contributors can be hidden — not invited, out of the default list — and deleted. What they sent
 * in stays either way: the record of what was published is the newsroom's.
 */
describe("hiding and deleting contributors", () => {
  let orgId: string;
  let adminId: string;
  let first: string;
  let second: string;

  beforeAll(async () => {
    await ensureSeeded();
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    await runAsOrganization(orgId, async () => {
      first = (await createContributor({ firstName: "Bulk", lastName: "One", email: "bulk.one@example.com", type: "STUDENT" } as never, adminId)).id;
      second = (await createContributor({ firstName: "Bulk", lastName: "Two", email: "bulk.two@example.com", type: "STUDENT" } as never, adminId)).id;
    });
  });

  it("hides several at once, and they leave the default list", async () => {
    await runAsOrganization(orgId, async () => {
      expect(await setContributorsActive([first, second], false, adminId)).toBe(2);
      const shown = (await listContributors({ active: "true" })).map((row) => row.id);
      expect(shown).not.toContain(first);
      const hidden = (await listContributors({ active: "false" })).map((row) => row.id);
      expect(hidden).toContain(first);
      expect(hidden).toContain(second);
      expect(await setContributorsActive([first], true, adminId)).toBe(1);
      expect((await listContributors({ active: "true" })).map((row) => row.id)).toContain(first);
    });
  });

  it("deletes several at once and keeps what they sent in", async () => {
    const edition = (await db.query.editions.findFirst({ where: eq(s.editions.organizationId, orgId) }))!;
    const [submission] = await db
      .insert(s.submissions)
      .values({ organizationId: orgId, editionId: edition.id, contributorId: second, title: "Their story", description: "Still the newsroom's", status: "NEW" } as never)
      .returning();
    await runAsOrganization(orgId, async () => {
      expect(await deleteContributors([first, second], adminId)).toBe(2);
    });
    expect(await db.query.contributors.findFirst({ where: eq(s.contributors.id, first) })).toBeUndefined();
    const kept = await db.query.submissions.findFirst({ where: eq(s.submissions.id, submission.id) });
    expect(kept).toBeDefined();
    expect(kept?.contributorId).toBeNull();
    await db.delete(s.submissions).where(eq(s.submissions.id, submission.id));
  });
});
