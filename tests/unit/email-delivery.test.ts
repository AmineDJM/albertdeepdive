import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { parseResendEvent, signSvix, tagValue, verifySvixSignature } from "@/server/email/providers/resend";
import { normaliseDomain, normaliseLocalPart, statusFor, suggestSendingDomain, toDnsRecords } from "@/server/email/domains";
import { hostFromNameservers, recordPublished, setDnsResolverForTests } from "@/server/email/dns";
import { formatSender } from "@/server/email/sender";

/**
 * The pure half of email delivery: what a signature proves, what an event means, what a domain
 * the customer typed becomes, and how the provider's records are named for a DNS editor.
 */

const secret = `whsec_${randomBytes(24).toString("base64")}`;

describe("webhook signatures", () => {
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "em_1" } });
  const now = 1_800_000_000_000;
  const timestamp = Math.floor(now / 1000);

  it("accepts a signature made with the secret, and nothing else", () => {
    const signature = signSvix(body, "msg_1", timestamp, secret);
    expect(verifySvixSignature(body, { id: "msg_1", timestamp: String(timestamp), signature }, secret, { now })).toBe(true);
    expect(verifySvixSignature(body, { id: "msg_1", timestamp: String(timestamp), signature: `v1,${signature.slice(3)} ${signature}` }, secret, { now })).toBe(true);
    expect(verifySvixSignature(`${body} `, { id: "msg_1", timestamp: String(timestamp), signature }, secret, { now })).toBe(false);
    expect(verifySvixSignature(body, { id: "msg_2", timestamp: String(timestamp), signature }, secret, { now })).toBe(false);
    expect(verifySvixSignature(body, { id: "msg_1", timestamp: String(timestamp), signature }, `whsec_${randomBytes(24).toString("base64")}`, { now })).toBe(false);
    expect(verifySvixSignature(body, { id: "msg_1", timestamp: String(timestamp), signature: signature.replace("v1,", "v0,") }, secret, { now })).toBe(false);
  });

  it("refuses a request from too long ago, or with a header missing", () => {
    const signature = signSvix(body, "msg_1", timestamp, secret);
    expect(verifySvixSignature(body, { id: "msg_1", timestamp: String(timestamp), signature }, secret, { now: now + 10 * 60_000 })).toBe(false);
    expect(verifySvixSignature(body, { id: null, timestamp: String(timestamp), signature }, secret, { now })).toBe(false);
    expect(verifySvixSignature(body, { id: "msg_1", timestamp: "soon", signature }, secret, { now })).toBe(false);
  });
});

describe("events, in Briefly's words", () => {
  it("reads a permanent bounce, a transient one, a click and a domain change", () => {
    const bounce = parseResendEvent({ type: "email.bounced", created_at: "2026-09-18T10:00:00Z", data: { email_id: "em_1", to: ["gone@example.com"], bounce: { type: "Permanent", subType: "General", message: "Mailbox does not exist" } } }, "msg_b")!;
    expect(bounce).toMatchObject({ kind: "bounced", permanent: true, providerMessageId: "em_1", recipients: ["gone@example.com"] });
    expect(bounce.detail).toContain("Mailbox does not exist");
    const soft = parseResendEvent({ type: "email.bounced", data: { email_id: "em_2", to: "full@example.com", bounce: { type: "Transient", subType: "MailboxFull", message: "Full" } } }, "msg_s")!;
    expect(soft).toMatchObject({ kind: "bounced", permanent: false, recipients: ["full@example.com"] });
    const click = parseResendEvent({ type: "email.clicked", data: { email_id: "em_3", to: ["a@example.com"], click: { link: "https://example.com/read" } } }, "msg_c")!;
    expect(click).toMatchObject({ kind: "clicked", detail: "https://example.com/read" });
    const domain = parseResendEvent({ type: "domain.updated", data: { id: "dom_1", name: "news.acme.com", status: "verified" } }, "msg_d")!;
    expect(domain).toMatchObject({ kind: "domain", providerDomainId: "dom_1", providerMessageId: null });
    expect(parseResendEvent({ type: "contact.created", data: {} }, "msg_o")?.kind).toBe("other");
    expect(parseResendEvent("nope", "msg_x")).toBeNull();
  });

  it("keeps tags in the provider's alphabet", () => {
    expect(tagValue("edition_email")).toBe("edition_email");
    expect(tagValue("acme corp/2026")).toBe("acme_corp_2026");
    expect(tagValue("")).toBe("_");
  });
});

describe("the domain the customer typed", () => {
  it("becomes a root and a recommended sending subdomain", () => {
    expect(normaliseDomain("https://www.Acme.com/about")).toEqual({ root: "acme.com", sending: null });
    expect(normaliseDomain("news.acme.com")).toEqual({ root: "acme.com", sending: "news.acme.com" });
    expect(normaliseDomain("someone@Acme.co.uk")).toEqual({ root: "acme.co.uk", sending: null });
    expect(suggestSendingDomain("acme.com")).toBe("news.acme.com");
    expect(suggestSendingDomain("acme.com", "mail")).toBe("mail.acme.com");
    expect(() => normaliseDomain("not a domain")).toThrow(/like acme.com/);
    expect(() => suggestSendingDomain("acme.com", "no spaces")).toThrow(/dashes/);
    expect(normaliseLocalPart(" Newsletter ")).toBe("newsletter");
    expect(normaliseLocalPart("")).toBe("newsletter");
    expect(() => normaliseLocalPart("a b")).toThrow();
  });

  it("names the provider's records the way a DNS editor asks for them", () => {
    const records = toDnsRecords(
      [
        { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, ttl: "Auto", status: "not_started" },
        { record: "SPF", name: "send", type: "TXT", value: '"v=spf1 include:amazonses.com ~all"', ttl: "Auto", status: "not_started" },
        { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=MIGf", ttl: "Auto", status: "not_started" },
        { record: "Tracking", name: "links.news.acme.com", type: "CNAME", value: "links1.resend-dns.com", ttl: "Auto", status: "not_started" },
      ],
      "news.acme.com",
      "acme.com",
    );
    expect(records.map((record) => [record.kind, record.host, record.fqdn])).toEqual([
      ["Return-Path", "send.news", "send.news.acme.com"],
      ["SPF", "send.news", "send.news.acme.com"],
      ["DKIM", "resend._domainkey.news", "resend._domainkey.news.acme.com"],
      ["Tracking", "links.news", "links.news.acme.com"],
    ]);
    expect(records[0].priority).toBe(10);
  });

  it("says where a domain stands in the customer's words", () => {
    const fresh = new Date();
    const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    expect(statusFor("verified", true, fresh)).toBe("READY");
    expect(statusFor("not_started", false, fresh)).toBe("WAITING_FOR_DNS");
    expect(statusFor("failed", false, fresh)).toBe("WAITING_FOR_DNS");
    expect(statusFor("not_started", false, old)).toBe("NEEDS_ATTENTION");
    expect(statusFor("pending", true, fresh)).toBe("VERIFYING");
    expect(statusFor("not_started", true, fresh)).toBe("VERIFYING");
    expect(statusFor("failed", true, fresh)).toBe("NEEDS_ATTENTION");
  });
});

describe("the customer's DNS", () => {
  it("recognises the host from its nameservers", () => {
    expect(hostFromNameservers(["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"], "acme.com")).toEqual({ name: "Cloudflare", url: "https://dash.cloudflare.com/?to=/:account/acme.com/dns/records" });
    expect(hostFromNameservers(["ns1.domaincontrol.com."], "acme.com")?.name).toBe("GoDaddy");
    expect(hostFromNameservers(["dns10.ovh.net"], "acme.fr")?.name).toBe("OVHcloud");
    expect(hostFromNameservers(["ns-1.awsdns-01.org"], "acme.com")?.name).toBe("Amazon Route 53");
    expect(hostFromNameservers(["ns1.example-registrar.net"], "acme.com")).toBeNull();
  });

  it("finds a record once it answers, chunked or capitalised or with a trailing dot", async () => {
    setDnsResolverForTests({
      resolveNs: async () => [],
      resolveTxt: async (name) => (name === "resend._domainkey.news.acme.com" ? [["p=MIGfAAAA", "BBBB"]] : name === "send.news.acme.com" ? [['"v=spf1 include:amazonses.com ~all"']] : []),
      resolveMx: async (name) => (name === "send.news.acme.com" ? [{ exchange: "Feedback-SMTP.eu-west-1.amazonses.com.", priority: 10 }] : []),
      resolveCname: async () => {
        throw Object.assign(new Error("ENODATA"), { code: "ENODATA" });
      },
    });
    try {
      const base = { kind: "DKIM", host: "x", ttl: "Auto", status: "not_started" };
      expect(await recordPublished({ ...base, type: "TXT", fqdn: "resend._domainkey.news.acme.com", value: "p=MIGfAAAABBBB" })).toBe(true);
      expect(await recordPublished({ ...base, type: "TXT", fqdn: "send.news.acme.com", value: "v=spf1 include:amazonses.com ~all" })).toBe(true);
      expect(await recordPublished({ ...base, type: "MX", fqdn: "send.news.acme.com", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10 })).toBe(true);
      expect(await recordPublished({ ...base, type: "TXT", fqdn: "resend._domainkey.news.acme.com", value: "p=SOMETHINGELSE" })).toBe(false);
      expect(await recordPublished({ ...base, type: "CNAME", fqdn: "links.news.acme.com", value: "links1.resend-dns.com" })).toBe(false);
      expect(await recordPublished({ ...base, type: "CAA", fqdn: "news.acme.com", value: "0 issue amazon.com" })).toBe(true);
    } finally {
      setDnsResolverForTests(null);
    }
  });
});

describe("the name on the envelope", () => {
  it("quotes what a mail header would misread", () => {
    expect(formatSender("Acme", "news@news.acme.com")).toBe("Acme <news@news.acme.com>");
    expect(formatSender("Acme, Inc. — Newsroom", "news@news.acme.com")).toBe('"Acme, Inc. — Newsroom" <news@news.acme.com>');
    expect(formatSender("Acme via Briefly", "preview@send.briefly.press")).toBe("Acme via Briefly <preview@send.briefly.press>");
    expect(formatSender("  ", "news@news.acme.com")).toBe("news@news.acme.com");
  });
});
