import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { updateSenderIdentity } from "@/server/email/domains";
import { envelopeFor, senderFor, senderIdentity } from "@/server/email/sender";
import { sendEmail } from "@/server/email";
import { createOrganization } from "@/server/tenancy/service";

/**
 * The sender is the customer's, whatever carries the mail.
 *
 * Before, a workspace without a domain of its own sent under Briefly's name, and through Brevo or a
 * mailbox the workspace's name was dropped altogether. What is checked here is that no message a
 * workspace sends carries the platform's name, that the name and reply address can be chosen with
 * no domain at all, and that one workspace's choice never reaches another's mail.
 */
describe("the workspace's sender", () => {
  let albertOrgId: string;
  let adminId: string;

  beforeAll(async () => {
    await ensureSeeded();
    albertOrgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    adminId = (await db.query.users.findFirst({ where: eq(s.users.email, "admin@albertschool.com") }))!.id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.BREVO_API_KEY;
    await updateSenderIdentity(albertOrgId, { senderName: "", replyTo: "" }, adminId);
  });

  afterAll(() => {
    delete process.env.BREVO_API_KEY;
  });

  it("is the workspace's name on Briefly's address when nothing is set up", async () => {
    const sender = await senderFor(albertOrgId);
    expect(sender).toMatchObject({ mode: "shared", name: "Albert School", domain: null });
    expect(sender.from).toBe(`Albert School <${sender.address}>`);

    const result = await sendEmail({ to: "reader@example.com", subject: "Hello", template: "test_send", organizationId: albertOrgId, layout: { title: "Hello", blocks: [] } });
    const row = await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, result.id) });
    expect(row?.fromAddress).toBe(sender.from);
    expect(row?.fromAddress).not.toMatch(/^Briefly\b/);
  });

  it("can be named and given a reply address with no domain of its own", async () => {
    const identity = await updateSenderIdentity(albertOrgId, { senderName: "  Albert's Deep Dive ", replyTo: " Editors@AlbertSchool.test " }, adminId);
    expect(identity).toMatchObject({ name: "Albert's Deep Dive", customName: "Albert's Deep Dive", replyTo: "editors@albertschool.test", localPart: null, workspaceName: "Albert School" });

    const envelope = await envelopeFor(albertOrgId);
    expect(envelope).toMatchObject({ name: "Albert's Deep Dive", replyTo: "editors@albertschool.test", transport: "log" });
    expect(envelope.from).toMatch(/^Albert's Deep Dive </);

    const result = await sendEmail({ to: "reader@example.com", subject: "Hello", template: "test_send", organizationId: albertOrgId, layout: { title: "Hello", blocks: [] } });
    expect((await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, result.id) }))?.fromAddress).toBe(envelope.from);
  });

  it("follows the workspace's name until another is chosen, and again once it is cleared", async () => {
    // Typing the workspace's own name is not a choice: it keeps following renames.
    expect(await updateSenderIdentity(albertOrgId, { senderName: "Albert School" }, adminId)).toMatchObject({ customName: null, name: "Albert School" });
    await db.update(s.organizations).set({ name: "Albert School of Data" }).where(eq(s.organizations.id, albertOrgId));
    try {
      expect((await senderFor(albertOrgId)).name).toBe("Albert School of Data");
      await updateSenderIdentity(albertOrgId, { senderName: "The Deep Dive" }, adminId);
      expect((await senderFor(albertOrgId)).name).toBe("The Deep Dive");
      await updateSenderIdentity(albertOrgId, { senderName: "   " }, adminId);
      expect((await senderIdentity(albertOrgId)).customName).toBeNull();
    } finally {
      await db.update(s.organizations).set({ name: "Albert School" }).where(eq(s.organizations.id, albertOrgId));
    }
  });

  it("keeps a name on one header line", async () => {
    const identity = await updateSenderIdentity(albertOrgId, { senderName: 'News\r\nBcc: victim@example.com <"x">' }, adminId);
    expect(identity.name).not.toMatch(/[\r\n<>"]/);
    expect((await senderFor(albertOrgId)).from.split("\n")).toHaveLength(1);
  });

  it("refuses a bad reply address, and an address on a domain it does not have", async () => {
    await expect(updateSenderIdentity(albertOrgId, { replyTo: "not-an-address" }, adminId)).rejects.toThrow(/valid/);
    await expect(updateSenderIdentity(albertOrgId, { localPart: "hello" }, adminId)).rejects.toThrow(/domain/);
  });

  it("rides on Brevo's verified address under the workspace's name", async () => {
    process.env.BREVO_API_KEY = "xkeysib-test";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ messageId: "<brevo-1>" }), { status: 201, headers: { "content-type": "application/json" } });
    });
    await updateSenderIdentity(albertOrgId, { senderName: "Albert's Deep Dive", replyTo: "editors@albertschool.test" }, adminId);

    const envelope = await envelopeFor(albertOrgId);
    expect(envelope.transport).toBe("brevo");
    const result = await sendEmail({ to: "reader@example.com", subject: "Hello", template: "test_send", organizationId: albertOrgId, layout: { title: "Hello", blocks: [] } });
    expect(result.ok).toBe(true);
    const sent = bodies.at(-1) as { sender: { name: string; email: string }; replyTo: { email: string } };
    expect(sent.sender).toEqual({ name: "Albert's Deep Dive", email: envelope.address });
    expect(sent.replyTo).toEqual({ email: "editors@albertschool.test" });
    expect((await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, result.id) }))?.fromAddress).toBe(`Albert's Deep Dive <${envelope.address}>`);
  });

  it("belongs to one workspace: another's mail keeps its own name, and the platform's keeps Briefly's", async () => {
    await updateSenderIdentity(albertOrgId, { senderName: "Albert's Deep Dive", replyTo: "editors@albertschool.test" }, adminId);
    const other = await createOrganization({ name: "Rivermouth Letters", type: "COMPANY", locale: "en", timezone: "Europe/Paris" }, adminId);
    expect(await senderFor(other.id)).toMatchObject({ name: "Rivermouth Letters" });
    expect((await senderFor(other.id)).replyTo).toBeUndefined();
    expect(await senderFor(null)).toMatchObject({ mode: "platform", name: "Briefly" });
  });
});
