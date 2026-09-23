import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { setEmailProviderForTests } from "@/server/email/providers";
import type { DeliveryEvent, EmailProvider, ProviderDomain, ProviderMessage } from "@/server/email/providers/types";
import { signSvix } from "@/server/email/providers/resend";
import { setDnsResolverForTests } from "@/server/email/dns";
import { checkPendingSendingDomains, checkSendingDomain, connectSendingDomain, disconnectSendingDomain, getSendingDomain, updateSenderIdentity } from "@/server/email/domains";
import { senderFor } from "@/server/email/sender";
import { sendEmail } from "@/server/email";
import { recordDeliveryEvent } from "@/server/email/events";
import { createOrganization } from "@/server/tenancy/service";
import { POST as resendWebhook } from "@/app/api/webhooks/resend/route";

/**
 * A customer's own domain, end to end, with the provider and the DNS stood in for.
 *
 * What is checked is Briefly's side of the contract: what the customer types becomes the right
 * registration, what the DNS answers decides when the provider is asked, the status turns to Ready
 * on its own and says so, and what the provider reports afterwards lands on the right rows — and
 * only those.
 */

/** A provider that remembers everything and answers what the test tells it to. */
class FakeProvider implements EmailProvider {
  readonly name = "resend" as const;
  domains = new Map<string, ProviderDomain>();
  sent: ProviderMessage[] = [];
  verified: string[] = [];
  deleted: string[] = [];
  private counter = 0;
  async send(message: ProviderMessage) {
    this.sent.push(message);
    this.counter += 1;
    return { providerMessageId: `em_${this.counter}` };
  }
  async createDomain(name: string, options: { region?: string } = {}) {
    const domain: ProviderDomain = {
      id: `dom_${this.domains.size + 1}`,
      name,
      status: "not_started",
      region: options.region,
      records: [
        { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, ttl: "Auto", status: "not_started" },
        { record: "SPF", name: "send", type: "TXT", value: '"v=spf1 include:amazonses.com ~all"', ttl: "Auto", status: "not_started" },
        { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=MIGfTEST", ttl: "Auto", status: "not_started" },
      ],
    };
    this.domains.set(domain.id, domain);
    return domain;
  }
  async getDomain(id: string) {
    const domain = this.domains.get(id);
    if (!domain) throw new Error("Domain not found");
    return domain;
  }
  async verifyDomain(id: string) {
    this.verified.push(id);
    const domain = await this.getDomain(id);
    domain.status = "pending";
  }
  async deleteDomain(id: string) {
    this.deleted.push(id);
    this.domains.delete(id);
  }
  async listDomains() {
    return [...this.domains.values()];
  }
  async createWebhook() {
    return { id: "wh_1", secret: "whsec_test" };
  }
  async listWebhooks() {
    return [];
  }
  async getWebhook(id: string) {
    return { id, endpoint: "", events: [], secret: null };
  }
}

const provider = new FakeProvider();
const published = new Set<string>();
const secret = `whsec_${randomBytes(24).toString("base64")}`;

describe("a customer's sending domain", () => {
  let albertOrgId: string;
  let adminId: string;

  beforeAll(async () => {
    await ensureSeeded();
    albertOrgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    adminId = (await db.query.users.findFirst({ where: eq(s.users.email, "admin@albertschool.com") }))!.id;
    process.env.RESEND_API_KEY = "re_test_fake";
    process.env.EMAIL_SHARED_DOMAIN = "send.briefly.test";
    process.env.RESEND_WEBHOOK_SECRET = secret;
    setEmailProviderForTests(provider);
    // The DNS answers exactly what the test has "published", nothing else.
    setDnsResolverForTests({
      resolveNs: async (name) => (name === "albertschool.test" ? ["ada.ns.cloudflare.com"] : []),
      resolveTxt: async (name) => {
        const answers: string[][] = [];
        if (published.has(`TXT ${name} spf`)) answers.push(['"v=spf1 include:amazonses.com ~all"']);
        if (published.has(`TXT ${name} dkim`)) answers.push(["p=MIGfTEST"]);
        return answers;
      },
      resolveMx: async (name) => (published.has(`MX ${name}`) ? [{ exchange: "feedback-smtp.eu-west-1.amazonses.com", priority: 10 }] : []),
      resolveCname: async () => [],
    });
  });

  afterAll(() => {
    setEmailProviderForTests(null);
    setDnsResolverForTests(null);
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_SHARED_DOMAIN;
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("sends under the workspace's own name from Briefly's address until it has a domain of its own", async () => {
    const sender = await senderFor(albertOrgId);
    expect(sender).toMatchObject({ mode: "shared", from: "Albert School <preview@send.briefly.test>" });
    const result = await sendEmail({ to: "reader@example.com", subject: "Hello", template: "test_send", organizationId: albertOrgId, layout: { title: "Hello", blocks: [{ type: "paragraph", text: "Hi" }] } });
    expect(result.ok).toBe(true);
    expect(provider.sent.at(-1)).toMatchObject({ from: "Albert School <preview@send.briefly.test>", to: "reader@example.com", tags: { workspace: albertOrgId, template: "test_send" } });
    const row = await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, result.id) });
    expect(row).toMatchObject({ provider: "resend", status: "SENT", fromAddress: "Albert School <preview@send.briefly.test>", delivery: "PENDING" });
    expect(row?.providerMessageId).toMatch(/^em_/);
  });

  it("turns one typed domain into a registration, records and a door to the DNS host", async () => {
    const row = await connectSendingDomain(albertOrgId, { domain: "https://www.AlbertSchool.test/" }, adminId);
    expect(row).toMatchObject({ rootDomain: "albertschool.test", domainName: "news.albertschool.test", status: "WAITING_FOR_DNS", senderLocalPart: "newsletter", dnsHost: "Cloudflare", providerRegion: "eu-west-1" });
    expect(row.providerDomainId).toBe("dom_1");
    expect(row.records.map((record) => `${record.type} ${record.host}`)).toEqual(["MX send.news", "TXT send.news", "TXT resend._domainkey.news"]);
    expect(row.records[0].fqdn).toBe("send.news.albertschool.test");
    expect(row.dnsHostUrl).toContain("cloudflare.com");
    const job = await db.query.jobs.findFirst({ where: eq(s.jobs.type, "email.domain.verify"), orderBy: [desc(s.jobs.createdAt)] });
    expect(job?.payload).toMatchObject({ organizationId: albertOrgId });
    await expect(connectSendingDomain(albertOrgId, { domain: "other.test" }, adminId)).rejects.toThrow(/already/);
  });

  it("waits for the records, asks the provider once they answer, and turns Ready on its own", async () => {
    let row = await checkSendingDomain(albertOrgId, { force: true });
    expect(row.status).toBe("WAITING_FOR_DNS");
    expect(row.records.every((record) => record.found === false)).toBe(true);
    expect(provider.verified).toEqual([]);

    published.add("MX send.news.albertschool.test");
    published.add("TXT send.news.albertschool.test spf");
    row = await checkSendingDomain(albertOrgId, { force: true });
    expect(row.status).toBe("WAITING_FOR_DNS");
    expect(row.records.filter((record) => record.found)).toHaveLength(2);
    expect(provider.verified).toEqual([]);

    published.add("TXT resend._domainkey.news.albertschool.test dkim");
    row = await checkSendingDomain(albertOrgId, { force: true });
    expect(provider.verified).toEqual(["dom_1"]);
    expect(row.status).toBe("VERIFYING");
    expect((await senderFor(albertOrgId)).mode).toBe("shared");

    provider.domains.get("dom_1")!.status = "verified";
    const before = provider.sent.length;
    row = await checkSendingDomain(albertOrgId, { force: true });
    expect(row.status).toBe("READY");
    expect(row.verifiedAt).toBeTruthy();
    expect(row.notifiedAt).toBeTruthy();

    // Told once: in the app, to whoever runs the workspace; by mail, from the domain itself.
    const notes = await db.select().from(s.notifications).where(and(eq(s.notifications.organizationId, albertOrgId), eq(s.notifications.type, "EMAIL_DOMAIN_READY")));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].href).toBe("/settings/email");
    expect(provider.sent.length).toBe(before + 1);
    expect(provider.sent.at(-1)?.from).toBe("Albert School <newsletter@news.albertschool.test>");
    const sender = await senderFor(albertOrgId);
    expect(sender).toMatchObject({ mode: "domain", from: "Albert School <newsletter@news.albertschool.test>", domain: "news.albertschool.test" });

    // Ready stays ready, and a second check does not tell anybody again.
    const again = await checkSendingDomain(albertOrgId, { force: true });
    expect(again.status).toBe("READY");
    expect(provider.sent.length).toBe(before + 1);
  });

  it("writes what the provider reports onto the right rows, and only those", async () => {
    const [subscriber] = await db.insert(s.subscribers).values({ organizationId: albertOrgId, email: "reader@bounce.test", status: "SUBSCRIBED", unsubscribeToken: randomBytes(12).toString("hex"), confirmedAt: new Date() }).returning();
    const sent = await sendEmail({ to: subscriber.email, subject: "Edition", template: "edition_email", organizationId: albertOrgId, layout: { title: "Edition", blocks: [] } });
    const log = (await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, sent.id) }))!;
    const messageId = log.providerMessageId!;
    const event = (type: string, id: string, extra: Record<string, unknown> = {}): DeliveryEvent => ({
      id,
      type,
      kind: type.split(".")[1] as DeliveryEvent["kind"],
      providerMessageId: messageId,
      providerDomainId: null,
      recipients: [subscriber.email],
      occurredAt: new Date(),
      detail: null,
      permanent: type === "email.bounced",
      raw: { type, ...extra },
    });

    expect(await recordDeliveryEvent(event("email.delivered", "msg_1"))).toMatchObject({ status: "recorded", emailLogId: log.id, organizationId: albertOrgId });
    expect(await recordDeliveryEvent(event("email.delivered", "msg_1"))).toEqual({ status: "duplicate" });
    await recordDeliveryEvent(event("email.opened", "msg_2"));
    await recordDeliveryEvent(event("email.opened", "msg_3"));
    let row = (await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, log.id) }))!;
    expect(row).toMatchObject({ delivery: "DELIVERED", opens: 2 });
    expect(row.openedAt).toBeTruthy();

    await recordDeliveryEvent({ ...event("email.bounced", "msg_4"), detail: "Permanent · General · Mailbox does not exist" });
    row = (await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, log.id) }))!;
    expect(row).toMatchObject({ delivery: "BOUNCED", deliveryDetail: "Permanent · General · Mailbox does not exist" });
    const reader = await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, subscriber.id) });
    expect(reader?.status).toBe("BOUNCED");
    // A late "delivered" does not talk over the bounce.
    await recordDeliveryEvent(event("email.delivered", "msg_5"));
    expect((await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, log.id) }))?.delivery).toBe("BOUNCED");

    // Another workspace's bounce for the same address leaves Albert School's reader alone.
    const rival = await createOrganization({ name: "Rival Letters", type: "COMPANY", locale: "en", timezone: "Europe/Paris" }, adminId);
    const [twin] = await db.insert(s.subscribers).values({ organizationId: albertOrgId, email: "shared@bounce.test", status: "SUBSCRIBED", unsubscribeToken: randomBytes(12).toString("hex"), confirmedAt: new Date() }).returning();
    const rivalSend = await sendEmail({ to: twin.email, subject: "Rival", template: "edition_email", organizationId: rival.id, layout: { title: "Rival", blocks: [] } });
    const rivalLog = (await db.query.emailLog.findFirst({ where: eq(s.emailLog.id, rivalSend.id) }))!;
    await recordDeliveryEvent({ ...event("email.bounced", "msg_6"), providerMessageId: rivalLog.providerMessageId, recipients: [twin.email] });
    expect((await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, twin.id) }))?.status).toBe("SUBSCRIBED");
    expect(await recordDeliveryEvent({ ...event("email.delivered", "msg_7"), providerMessageId: "em_unknown" })).toEqual({ status: "ignored" });
  });

  it("only believes a webhook it can verify", async () => {
    const body = JSON.stringify({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: "em_unknown", to: ["x@example.com"] } });
    const timestamp = Math.floor(Date.now() / 1000);
    const good = new Request("http://localhost/api/webhooks/resend", { method: "POST", body, headers: { "svix-id": "msg_route_1", "svix-timestamp": String(timestamp), "svix-signature": signSvix(body, "msg_route_1", timestamp, secret) } });
    const ok = await resendWebhook(good);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: true, status: "ignored" });
    const bad = new Request("http://localhost/api/webhooks/resend", { method: "POST", body, headers: { "svix-id": "msg_route_2", "svix-timestamp": String(timestamp), "svix-signature": "v1,AAAA" } });
    expect((await resendWebhook(bad)).status).toBe(400);
    expect(await db.query.emailEvents.findFirst({ where: eq(s.emailEvents.providerEventId, "msg_route_2") })).toBeUndefined();
  });

  it("lets the workspace choose the name and address, and lets it leave keeping its name", async () => {
    const updated = await updateSenderIdentity(albertOrgId, { senderName: "Albert School Newsroom", localPart: "Hello", replyTo: "editors@albertschool.test" }, adminId);
    expect(updated).toMatchObject({ name: "Albert School Newsroom", customName: "Albert School Newsroom", localPart: "hello", replyTo: "editors@albertschool.test" });
    expect(await senderFor(albertOrgId)).toMatchObject({ from: "Albert School Newsroom <hello@news.albertschool.test>", replyTo: "editors@albertschool.test" });
    await expect(updateSenderIdentity(albertOrgId, { replyTo: "not-an-address" }, adminId)).rejects.toThrow(/valid/);

    await disconnectSendingDomain(albertOrgId, adminId);
    expect(await getSendingDomain(albertOrgId)).toBeNull();
    expect(provider.deleted).toEqual(["dom_1"]);
    // The name and the reply address were the workspace's, not the domain's: they stay.
    expect(await senderFor(albertOrgId)).toMatchObject({ from: "Albert School Newsroom <preview@send.briefly.test>", replyTo: "editors@albertschool.test" });
    await updateSenderIdentity(albertOrgId, { senderName: "", replyTo: "" }, adminId);
    expect((await senderFor(albertOrgId)).mode).toBe("shared");
  });

  it("sweeps every domain still on its way", async () => {
    published.clear();
    await connectSendingDomain(albertOrgId, { domain: "albertschool.test", subdomain: "mail" }, adminId);
    const result = await checkPendingSendingDomains({ now: new Date(Date.now() + 10 * 60_000) });
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect((await getSendingDomain(albertOrgId))?.status).toBe("WAITING_FOR_DNS");
    await disconnectSendingDomain(albertOrgId, adminId);
  });
});
