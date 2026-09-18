import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeliveryEvent, DeliveryEventKind, EmailProvider, ProviderDomain, ProviderMessage } from "./types";

/**
 * Resend, behind the provider interface.
 *
 * The SDK does the talking. Webhook signatures are checked here by hand rather than through it:
 * the algorithm is small, documented, and a thing this code should be able to prove about itself
 * in a test with no network and no library.
 */

/** Every event Briefly wants to hear about. Contacts stay in Briefly, so their events are not asked for. */
export const RESEND_WEBHOOK_EVENTS = ["email.sent", "email.delivered", "email.delivery_delayed", "email.bounced", "email.complained", "email.opened", "email.clicked", "email.failed", "email.suppressed", "domain.created", "domain.updated", "domain.deleted"] as const;

type SdkResponse<T> = { data: T | null; error: { message: string; name?: string } | null };

function unwrap<T>(response: SdkResponse<T>, what: string): T {
  if (response.error) throw new Error(`Resend could not ${what}: ${response.error.message}`);
  if (!response.data) throw new Error(`Resend returned nothing when asked to ${what}.`);
  return response.data;
}

type SdkRecord = { record: string; name: string; type: string; value: string; priority?: number; ttl?: string; status: string };
type SdkDomain = { id: string; name: string; status: string; region?: string; records?: SdkRecord[] };

function domainFrom(domain: SdkDomain): ProviderDomain {
  return {
    id: domain.id,
    name: domain.name,
    status: domain.status,
    region: domain.region,
    records: (domain.records ?? []).map((record) => ({ record: record.record, name: record.name, type: record.type, value: record.value, priority: record.priority, ttl: record.ttl, status: record.status })),
  };
}

export class ResendProvider implements EmailProvider {
  readonly name = "resend" as const;

  constructor(private readonly apiKey: string) {}

  private async client() {
    const { Resend } = await import("resend");
    return new Resend(this.apiKey);
  }

  async send(message: ProviderMessage) {
    const resend = await this.client();
    const result = await resend.emails.send({
      from: message.from,
      to: message.to,
      cc: message.cc ? [message.cc] : undefined,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.listUnsubscribeUrl ? { "List-Unsubscribe": `<${message.listUnsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      tags: message.tags ? Object.entries(message.tags).map(([name, value]) => ({ name, value: tagValue(value) })) : undefined,
    });
    if (result.error) throw new Error(result.error.message);
    return { providerMessageId: result.data?.id };
  }

  async createDomain(name: string, options: { region?: string } = {}) {
    const resend = await this.client();
    const region = options.region as "us-east-1" | "eu-west-1" | "sa-east-1" | "ap-northeast-1" | undefined;
    const created = unwrap(await resend.domains.create({ name, region }), `register ${name}`);
    return domainFrom(created as unknown as SdkDomain);
  }

  async getDomain(id: string) {
    const resend = await this.client();
    return domainFrom(unwrap(await resend.domains.get(id), "read the domain") as unknown as SdkDomain);
  }

  async verifyDomain(id: string) {
    const resend = await this.client();
    unwrap(await resend.domains.verify(id), "check the domain");
  }

  async deleteDomain(id: string) {
    const resend = await this.client();
    unwrap(await resend.domains.remove(id), "remove the domain");
  }

  async listDomains() {
    const resend = await this.client();
    const page = unwrap(await resend.domains.list(), "list domains") as unknown as { data?: SdkDomain[] };
    return (page.data ?? []).map(domainFrom);
  }

  async createWebhook(endpoint: string, events: string[]) {
    const resend = await this.client();
    const created = unwrap(await resend.webhooks.create({ endpoint, events: events as never[] }), "create the webhook");
    return { id: created.id, secret: created.signing_secret };
  }

  async getWebhook(id: string) {
    const resend = await this.client();
    const hook = unwrap(await resend.webhooks.get(id), "read the webhook");
    return { id: hook.id, endpoint: hook.endpoint, events: hook.events ?? [], secret: hook.signing_secret ?? null };
  }

  async listWebhooks() {
    const resend = await this.client();
    const page = unwrap(await resend.webhooks.list(), "list webhooks") as unknown as { data?: { id: string; endpoint: string; events?: string[] | null; signing_secret?: string }[] };
    return (page.data ?? []).map((hook) => ({ id: hook.id, endpoint: hook.endpoint, events: hook.events ?? [], secret: hook.signing_secret ?? null }));
  }
}

/** Resend accepts only letters, digits, dashes and underscores in a tag. */
export function tagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) || "_";
}

/* ── Webhooks ─────────────────────────────────────────────────────────────────────────────── */

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/**
 * Standard Webhooks (Svix) verification: HMAC-SHA256 over "id.timestamp.body" with the secret's
 * base64 half, compared in constant time against any of the space-separated "v1,…" signatures.
 * A timestamp too far from now is rejected so a captured request cannot be replayed later.
 */
export function verifySvixSignature(payload: string, headers: SvixHeaders, secret: string, options: { toleranceSeconds?: number; now?: number } = {}): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature || !secret) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  const now = (options.now ?? Date.now()) / 1000;
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300)) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${payload}`).digest();
  return headers.signature.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Sign a payload the way Svix would, for tests and for anything that must imitate the provider. */
export function signSvix(payload: string, id: string, timestamp: number, secret: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64")}`;
}

const KINDS: Record<string, DeliveryEventKind> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
  "domain.created": "domain",
  "domain.updated": "domain",
  "domain.deleted": "domain",
};

type ResendPayload = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    id?: string;
    to?: string[] | string;
    created_at?: string;
    bounce?: { message?: string; type?: string; subType?: string };
    click?: { link?: string };
    failed?: { reason?: string };
    reason?: string;
    status?: string;
    name?: string;
  };
};

/** Translate one Resend webhook body into Briefly's vocabulary; null when it is not one. */
export function parseResendEvent(body: unknown, eventId: string): DeliveryEvent | null {
  const payload = body as ResendPayload;
  if (!payload || typeof payload !== "object" || typeof payload.type !== "string") return null;
  const data = payload.data ?? {};
  const kind = KINDS[payload.type] ?? "other";
  const recipients = Array.isArray(data.to) ? data.to.filter((to): to is string => typeof to === "string") : typeof data.to === "string" ? [data.to] : [];
  const occurred = new Date(payload.created_at ?? data.created_at ?? Date.now());
  const detail =
    kind === "bounced"
      ? [data.bounce?.type, data.bounce?.subType, data.bounce?.message].filter(Boolean).join(" · ") || null
      : kind === "clicked"
        ? (data.click?.link ?? null)
        : kind === "failed"
          ? (data.failed?.reason ?? data.reason ?? null)
          : kind === "domain"
            ? [data.name, data.status].filter(Boolean).join(" · ") || null
            : null;
  const permanent = kind === "bounced" ? (data.bounce?.type ?? "").toLowerCase() !== "transient" : kind === "complained" || kind === "suppressed";
  return {
    id: eventId,
    type: payload.type,
    kind,
    providerMessageId: kind === "domain" ? null : (data.email_id ?? null),
    providerDomainId: kind === "domain" ? (data.id ?? null) : null,
    recipients,
    occurredAt: Number.isNaN(occurred.getTime()) ? new Date() : occurred,
    detail,
    permanent,
    raw: body,
  };
}
