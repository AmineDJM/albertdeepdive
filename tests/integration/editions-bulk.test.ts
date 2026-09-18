import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createEdition, deleteEditions, getCurrentEdition, listEditions, setEditionsHidden } from "@/server/editions/service";
import { getStorage } from "@/server/storage";

/**
 * Editions can be put away, and can be taken away.
 *
 * Hiding is housekeeping: the edition leaves every list and comes back in one click, and nothing
 * about it changes. Deleting takes the edition and what was only ever its own — and leaves what
 * was not: the organisation's photographs, the contributors, the Studio packs.
 */
describe("hiding and deleting editions", () => {
  let orgId: string;
  let adminId: string;
  let first: string;
  let second: string;

  beforeAll(async () => {
    await ensureSeeded();
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    await runAsOrganization(orgId, async () => {
      first = (await createEdition({ title: "Bulk one", month: 1, year: 2031, isSpecialIssue: true }, adminId)).id;
      second = (await createEdition({ title: "Bulk two", month: 2, year: 2031, isSpecialIssue: true }, adminId)).id;
    });
  });

  it("hides several at once, and shows them again", async () => {
    await runAsOrganization(orgId, async () => {
      expect(await setEditionsHidden([first, second], true, adminId)).toBe(2);
      const shown = (await listEditions()).map((edition) => edition.id);
      expect(shown).not.toContain(first);
      expect(shown).not.toContain(second);
      const all = (await listEditions({ includeHidden: true })).map((edition) => edition.id);
      expect(all).toContain(first);
      expect(all).toContain(second);
      // The one the newsroom is working on is never a hidden one.
      expect((await getCurrentEdition())?.id).not.toBe(first);

      expect(await setEditionsHidden([first], false, adminId)).toBe(1);
      expect((await listEditions()).map((edition) => edition.id)).toContain(first);
    });
  });

  it("deletes several at once, files included, and leaves the library alone", async () => {
    const storage = await getStorage();
    // A rendered file that belongs to the edition, and a photograph that only passed through it.
    const [submission] = await db
      .insert(s.submissions)
      .values({ organizationId: orgId, editionId: second, title: "A note", description: "With a file attached", status: "NEW" } as never)
      .returning();
    const attachmentKey = `attachments/${submission.id}/note.pdf`;
    await storage.put(attachmentKey, Buffer.from("pdf"), { contentType: "application/pdf" });
    await db.insert(s.submissionAttachments).values({ submissionId: submission.id, kind: "DOCUMENT", fileName: "note.pdf", mimeType: "application/pdf", sizeBytes: 3, storageKey: attachmentKey });
    const [asset] = await db
      .insert(s.mediaAssets)
      .values({ organizationId: orgId, editionId: second, fileName: "keep.jpg", mimeType: "image/jpeg", sizeBytes: 3, storageKey: `media/${crypto.randomUUID()}/original.jpg`, kind: "photo", rightsStatus: "GREEN" } as never)
      .returning();
    await storage.put(asset.storageKey, Buffer.from("jpg"), { contentType: "image/jpeg" });

    await runAsOrganization(orgId, async () => {
      expect(await deleteEditions([first, second], adminId)).toBe(2);
    });
    expect(await db.query.editions.findFirst({ where: eq(s.editions.id, first) })).toBeUndefined();
    expect(await db.query.submissions.findFirst({ where: eq(s.submissions.id, submission.id) })).toBeUndefined();
    expect(await storage.exists(attachmentKey)).toBe(false);
    // The photograph is the organisation's: still here, no longer filed under an edition that is gone.
    const kept = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, asset.id) });
    expect(kept?.editionId).toBeNull();
    expect(await storage.exists(asset.storageKey)).toBe(true);
    await storage.delete(asset.storageKey);
    await db.delete(s.mediaAssets).where(eq(s.mediaAssets.id, asset.id));
  });

  it("touches nothing that belongs to another organisation", async () => {
    // Scoped to the active workspace: an id from elsewhere is simply not found.
    const [other] = await db.insert(s.organizations).values({ name: "Elsewhere", slug: `elsewhere-${Date.now().toString(36)}`, type: "COMPANY" }).returning();
    const [theirs] = await db.insert(s.editions).values({ organizationId: other.id, issueNumber: 1, title: "Theirs", slug: "theirs", label: "Theirs", month: 1, year: 2031 }).returning();
    await runAsOrganization(orgId, async () => {
      expect(await setEditionsHidden([theirs.id], true, adminId)).toBe(0);
      expect(await deleteEditions([theirs.id], adminId)).toBe(0);
    });
    expect(await db.query.editions.findFirst({ where: eq(s.editions.id, theirs.id) })).toBeDefined();
    await db.delete(s.organizations).where(eq(s.organizations.id, other.id));
  });
});
