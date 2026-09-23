import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { DnsRecord, SendingDomainRow } from "@/server/db/schema/email";
import { getEmailProvider } from "./providers";
import type { EmailProvider, ProviderDomain, ProviderRecord } from "./providers/types";
import { detectDnsHost, domainConnectApplyUrl, recordPublished } from "./dns";
import { deliveryConfig, senderFor, senderIdentity, type SenderIdentity } from "./sender";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { env } from "@/server/env";
import { BRAND } from "@/lib/brand";
import { AppError, NotFoundError, ValidationError } from "@/lib/action-result";

const log = createLogger("sending-domains");

/**
 * A customer's own sending domain, from "Connect my domain" to "Ready to send".
 *
 * The customer types one thing — acme.com — and Briefly does the rest: picks a subdomain that keeps
 * the company's own mail reputation apart (news.acme.com), registers it with the provider, reads
 * back the handful of DNS records that make it theirs, finds out who hosts their DNS so the screen
 * can open the right door, and then watches. Watching is the point. The provider is asked to verify
 * only once the records are actually answering from the DNS — asking sooner marks the domain
 * "failed" before the customer has done anything wrong — and it is asked again on every sweep, on
 * every visit to the screen and on every webhook, so the status turns to Ready on its own and the
 * people who run the workspace are told once, in the app and by mail.
 */

export const SENDING_PREFIXES = ["news", "mail", "newsletter", "updates"] as const;
export const DEFAULT_LOCAL_PART = "newsletter";
/** How long a domain may wait for its records before the screen says it needs a look. */
const PATIENCE_MS = 72 * 60 * 60 * 1000;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "https://www.Acme.com/about" → acme.com; "news.acme.com" → the sending name they already chose. */
export function normaliseDomain(input: string): { root: string; sending: string | null } {
  let value = (input ?? "").trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (value.includes("@")) value = value.split("@")[1] ?? "";
  if (!DOMAIN.test(value)) throw new ValidationError("Enter a domain like acme.com", { domain: ["Enter a domain like acme.com"] });
  const labels = value.split(".");
  if (labels.length >= 3 && (SENDING_PREFIXES as readonly string[]).includes(labels[0])) return { root: labels.slice(1).join("."), sending: value };
  return { root: value, sending: null };
}

/** The subdomain Briefly recommends: news.acme.com, or whatever label the customer chose under Advanced. */
export function suggestSendingDomain(root: string, label?: string | null): string {
  const chosen = (label ?? SENDING_PREFIXES[0]).trim().toLowerCase();
  if (!LABEL.test(chosen)) throw new ValidationError("Use letters, numbers and dashes for the subdomain", { subdomain: ["Letters, numbers and dashes only"] });
  return `${chosen}.${root}`;
}

export function normaliseLocalPart(input?: string | null): string {
  const value = (input ?? "").trim().toLowerCase();
  if (!value) return DEFAULT_LOCAL_PART;
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(value)) throw new ValidationError("Use letters, numbers, dots and dashes for the address", { localPart: ["Letters, numbers, dots and dashes only"] });
  return value;
}

/**
 * The provider names records relative to the domain it registered ("send", "resend._domainkey");
 * a DNS host wants them relative to the zone the customer owns ("send.news", "resend._domainkey.news")
 * or whole. Both are kept, so nobody has to do that arithmetic at a DNS editor.
 */
export function toDnsRecords(records: ProviderRecord[], domainName: string, rootDomain: string): DnsRecord[] {
  return records.map((record) => {
    const raw = record.name.replace(/\.$/, "").toLowerCase();
    const fqdn = raw === "" || raw === "@" ? domainName : raw === domainName || raw.endsWith(`.${domainName}`) || raw.endsWith(`.${rootDomain}`) || raw === rootDomain ? raw : `${raw}.${domainName}`;
    const host = fqdn === rootDomain ? "@" : fqdn.endsWith(`.${rootDomain}`) ? fqdn.slice(0, -(rootDomain.length + 1)) : fqdn;
    const kind = record.record === "SPF" && record.type.toUpperCase() === "MX" ? "Return-Path" : record.record;
    return { kind, type: record.type.toUpperCase(), host, fqdn, value: record.value, priority: record.priority, ttl: record.ttl, status: record.status };
  });
}

/** The provider's word for the domain, in the customer's: never "failed" while they are still adding records. */
export function statusFor(remote: string, allFound: boolean, connectedAt: Date, now = new Date()): SendingDomainRow["status"] {
  if (remote === "verified") return "READY";
  if (!allFound) return now.getTime() - connectedAt.getTime() > PATIENCE_MS ? "NEEDS_ATTENTION" : "WAITING_FOR_DNS";
  if (remote === "failed" || remote === "partially_failed") return "NEEDS_ATTENTION";
  return "VERIFYING";
}

export async function getSendingDomain(organizationId: string): Promise<SendingDomainRow | null> {
  return (await db.query.sendingDomains.findFirst({ where: eq(s.sendingDomains.organizationId, organizationId) })) ?? null;
}

/** What to offer before the customer has typed anything: their website, as a domain. */
export async function sendingDomainSuggestion(organizationId: string): Promise<{ root: string; sending: string } | null> {
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { website: true } });
  if (!organization?.website) return null;
  try {
    const { root, sending } = normaliseDomain(organization.website);
    return { root, sending: sending ?? suggestSendingDomain(root) };
  } catch {
    return null;
  }
}

async function requireProvider(): Promise<EmailProvider> {
  const provider = await getEmailProvider();
  if (!provider) throw new AppError("Email delivery is not connected on this Briefly yet. Ask its administrator to finish setting it up.", "EMAIL_NOT_CONFIGURED", 503);
  return provider;
}

/** Register the name, or pick it up where an earlier attempt left it. */
async function registerDomain(provider: EmailProvider, name: string, region: string): Promise<ProviderDomain> {
  try {
    return await provider.createDomain(name, { region });
  } catch (err) {
    const existing = (await provider.listDomains().catch(() => [])).find((domain) => domain.name.toLowerCase() === name);
    if (existing) return provider.getDomain(existing.id);
    throw err;
  }
}

export type ConnectInput = { domain: string; subdomain?: string | null; localPart?: string | null };

export async function connectSendingDomain(organizationId: string, input: ConnectInput, actorId?: string | null): Promise<SendingDomainRow> {
  const provider = await requireProvider();
  if (await getSendingDomain(organizationId)) throw new AppError("This workspace already sends from its own domain. Remove it under Advanced to connect another.", "DOMAIN_EXISTS", 409);
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { id: true, name: true } });
  if (!organization) throw new NotFoundError("Workspace");

  const { root, sending } = normaliseDomain(input.domain);
  const domainName = sending ?? suggestSendingDomain(root, input.subdomain);
  const localPart = normaliseLocalPart(input.localPart);
  const config = await deliveryConfig();

  // The row goes in first: a provider that is down leaves a visible "setting up" to retry, not nothing.
  const [row] = await db
    .insert(s.sendingDomains)
    .values({ organizationId, rootDomain: root, domainName, status: "SETTING_UP", senderLocalPart: localPart, connectedById: actorId ?? null, providerRegion: config.region })
    .returning();

  try {
    const registered = await registerDomain(provider, domainName, config.region);
    const records = toDnsRecords(registered.records, domainName, root);
    const host = await detectDnsHost(root);
    const oneClickUrl = config.domainConnect ? await domainConnectApplyUrl({ root, host: domainName.slice(0, -(root.length + 1)), variables: variablesFor(records), template: config.domainConnect }) : null;
    const [updated] = await db
      .update(s.sendingDomains)
      .set({ providerDomainId: registered.id, providerRegion: registered.region ?? config.region, records, status: "WAITING_FOR_DNS", dnsHost: host?.name ?? null, dnsHostUrl: host?.url ?? null, oneClickUrl, lastCheckedAt: new Date(), lastError: null })
      .where(eq(s.sendingDomains.id, row.id))
      .returning();
    await audit({ action: "email.domain.connect", organizationId, userId: actorId ?? null, entityType: "SETTING", entityId: row.id, metadata: { domain: domainName, host: host?.name ?? null, records: records.length } });
    // A first look soon after, on the queue, so the customer who pastes the records straight away
    // sees the change without a sweep having to come round.
    await enqueueJob({ type: JOB_TYPES.EMAIL_DOMAIN_VERIFY, payload: { organizationId }, idempotencyKey: `email-domain-verify:${organizationId}:${row.id}`, runAt: new Date(Date.now() + 90_000), createdById: actorId ?? null, priority: 4 });
    kickJobRunner();
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(s.sendingDomains).set({ status: "NEEDS_ATTENTION", lastError: message, lastCheckedAt: new Date() }).where(eq(s.sendingDomains.id, row.id));
    log.error("domain registration failed", { organizationId, domainName, err });
    throw new AppError(`The domain could not be registered: ${message}`, "DOMAIN_REGISTRATION_FAILED", 502);
  }
}

/** The values a Domain Connect template would ask for, named plainly. */
function variablesFor(records: DnsRecord[]): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const record of records) {
    const key = `${record.kind.toLowerCase().replace(/[^a-z]/g, "")}_${record.type.toLowerCase()}`;
    variables[key] = record.value;
    if (record.priority !== undefined) variables[`${key}_priority`] = String(record.priority);
  }
  return variables;
}

/** Merge the provider's latest view of the records over ours, keeping our own "found" answer. */
function mergeRecords(current: DnsRecord[], latest: DnsRecord[]): DnsRecord[] {
  return latest.map((record) => {
    const known = current.find((candidate) => candidate.fqdn === record.fqdn && candidate.type === record.type);
    return { ...record, found: known?.found };
  });
}

export type CheckOptions = { force?: boolean; minIntervalMs?: number; now?: Date };

/**
 * Look at one domain: our own DNS answers first, then the provider's verdict.
 *
 * Throttled, because it is called from the screen on every visit and from a client that refreshes
 * while the customer waits; forced from the sweep, the job and the webhook.
 */
export async function checkSendingDomain(target: string | SendingDomainRow, options: CheckOptions = {}): Promise<SendingDomainRow> {
  const row = typeof target === "string" ? await getSendingDomain(target) : target;
  if (!row) throw new NotFoundError("Sending domain");
  const now = options.now ?? new Date();
  if (row.status === "READY" && !options.force) return row;
  if (!options.force && row.lastCheckedAt && now.getTime() - row.lastCheckedAt.getTime() < (options.minIntervalMs ?? 30_000)) return row;
  const provider = await getEmailProvider();
  if (!provider || !row.providerDomainId) return row;

  try {
    let remote = await provider.getDomain(row.providerDomainId);
    let records = mergeRecords(row.records, toDnsRecords(remote.records, row.domainName, row.rootDomain));
    const found = await Promise.all(records.map((record) => recordPublished(record)));
    records = records.map((record, i) => ({ ...record, found: found[i] }));
    const allFound = records.every((record) => record.found || record.type === "CAA");

    // Ask the provider to look only once there is something to see, and again when its last look
    // failed but the records have since appeared.
    if (allFound && remote.status !== "verified" && remote.status !== "pending") {
      await provider.verifyDomain(row.providerDomainId);
      remote = await provider.getDomain(row.providerDomainId);
      records = mergeRecords(records, toDnsRecords(remote.records, row.domainName, row.rootDomain));
    }

    const status = statusFor(remote.status, allFound, row.createdAt, now);
    const became = status === "READY" && row.status !== "READY";
    const [updated] = await db
      .update(s.sendingDomains)
      .set({
        records,
        status,
        lastCheckedAt: now,
        lastError: status === "NEEDS_ATTENTION" ? (allFound ? `The provider could not verify the records it found (${remote.status}).` : "The records have not appeared after three days.") : null,
        verifiedAt: status === "READY" ? (row.verifiedAt ?? now) : row.verifiedAt,
      })
      .where(eq(s.sendingDomains.id, row.id))
      .returning();
    if (became) {
      await audit({ action: "email.domain.verified", organizationId: row.organizationId, entityType: "SETTING", entityId: row.id, metadata: { domain: row.domainName } });
      await notifyReady(updated).catch((err) => log.warn("could not notify about the verified domain", { organizationId: row.organizationId, err }));
      return (await getSendingDomain(row.organizationId)) ?? updated;
    }
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("domain check failed", { organizationId: row.organizationId, err });
    const [updated] = await db.update(s.sendingDomains).set({ lastCheckedAt: now, lastError: message }).where(eq(s.sendingDomains.id, row.id)).returning();
    return updated;
  }
}

/** Every domain still on its way, looked at again — the sweep behind "you never have to click". */
export async function checkPendingSendingDomains(options: { now?: Date; limit?: number } = {}): Promise<{ checked: number; ready: number }> {
  const now = options.now ?? new Date();
  const soon = new Date(now.getTime() - 4 * 60_000);
  const later = new Date(now.getTime() - 60 * 60_000);
  const rows = await db
    .select()
    .from(s.sendingDomains)
    .where(
      or(
        and(inArray(s.sendingDomains.status, ["WAITING_FOR_DNS", "VERIFYING", "SETTING_UP"]), or(isNull(s.sendingDomains.lastCheckedAt), lt(s.sendingDomains.lastCheckedAt, soon))),
        and(eq(s.sendingDomains.status, "NEEDS_ATTENTION"), or(isNull(s.sendingDomains.lastCheckedAt), lt(s.sendingDomains.lastCheckedAt, later))),
      ),
    )
    .limit(options.limit ?? 50);
  let ready = 0;
  for (const row of rows) {
    const result = await checkSendingDomain(row, { force: true, now });
    if (result.status === "READY" && row.status !== "READY") ready += 1;
  }
  return { checked: rows.length, ready };
}

const READY_WORDS = {
  en: {
    title: (domain: string) => `Ready to send from ${domain}`,
    body: (sender: string) => `Your editions now go out as ${sender}.`,
    subject: (domain: string) => `${domain} is ready to send`,
    intro: (domain: string, sender: string) => `The records for ${domain} were found and verified. From now on your editions and invitations go out as ${sender} — this message is the first of them.`,
    cta: "Open email settings",
  },
  fr: {
    title: (domain: string) => `Prêt à envoyer depuis ${domain}`,
    body: (sender: string) => `Vos parutions partent désormais en tant que ${sender}.`,
    subject: (domain: string) => `${domain} est prêt à envoyer`,
    intro: (domain: string, sender: string) => `Les enregistrements de ${domain} ont été trouvés et vérifiés. Vos parutions et invitations partent désormais en tant que ${sender} — ce message est le premier d'entre eux.`,
    cta: "Ouvrir les réglages email",
  },
} as const;

/** Tell the people who run the workspace, once: in the app for all of them, by mail to whoever connected it. */
async function notifyReady(row: SendingDomainRow) {
  if (row.notifiedAt) return;
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, row.organizationId), columns: { locale: true } });
  const words = READY_WORDS[organization?.locale === "fr" ? "fr" : "en"];
  const sender = (await senderFor(row.organizationId)).from;
  const admins = await db
    .select({ id: s.users.id, email: s.users.email })
    .from(s.organizationMembers)
    .innerJoin(s.users, eq(s.users.id, s.organizationMembers.userId))
    .where(and(eq(s.organizationMembers.organizationId, row.organizationId), inArray(s.organizationMembers.role, ["OWNER", "ADMIN"]), eq(s.users.isActive, true)));
  if (admins.length) {
    await db.insert(s.notifications).values(admins.map((admin) => ({ organizationId: row.organizationId, userId: admin.id, type: "EMAIL_DOMAIN_READY" as const, title: words.title(row.domainName), body: words.body(sender), href: "/settings/email" })));
  }
  const recipient = (row.connectedById && admins.find((admin) => admin.id === row.connectedById)) || admins[0];
  if (recipient) {
    const { sendEmail } = await import("./index");
    await sendEmail({
      to: recipient.email,
      subject: words.subject(row.domainName),
      template: "email_domain_ready",
      organizationId: row.organizationId,
      entityType: "SETTING",
      entityId: row.id,
      layout: {
        appName: BRAND.name,
        kicker: BRAND.name,
        title: words.title(row.domainName),
        preheader: words.subject(row.domainName),
        blocks: [{ type: "paragraph", text: words.intro(row.domainName, sender) }],
        cta: { label: words.cta, url: `${env.NEXT_PUBLIC_APP_URL}/settings/email` },
      },
    });
  }
  await db.update(s.sendingDomains).set({ notifiedAt: new Date() }).where(eq(s.sendingDomains.id, row.id));
}

export type SenderPatch = { senderName?: string | null; localPart?: string | null; replyTo?: string | null };

/** A name as a mail header can carry it: one line, no quotes or angle brackets, at most 80 characters. */
function cleanSenderName(value: string): string {
  return value.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * The name and reply address on every message the workspace sends, and the address on its own domain.
 *
 * The name and the reply address are the workspace's whether or not it has a domain: a customer
 * sending from Briefly's address still sends under its own name. An empty name goes back to
 * following the workspace's name; an empty reply address lets replies go where the envelope says.
 * Only the part before the @ needs a domain, because there is no address to choose without one.
 */
export async function updateSenderIdentity(organizationId: string, patch: SenderPatch, actorId?: string | null): Promise<SenderIdentity> {
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { id: true, name: true } });
  if (!organization) throw new NotFoundError("Workspace");
  const values: Partial<typeof s.organizations.$inferInsert> = {};
  if (patch.senderName !== undefined) {
    const name = cleanSenderName(patch.senderName ?? "");
    values.senderName = name && name !== organization.name ? name : null;
  }
  if (patch.replyTo !== undefined) {
    const replyTo = (patch.replyTo ?? "").trim().toLowerCase();
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) throw new ValidationError("Enter a valid reply address", { replyTo: ["Enter a valid email address"] });
    values.senderReplyTo = replyTo || null;
  }
  let localPart: string | undefined;
  if (patch.localPart !== undefined && patch.localPart !== null) {
    const row = await getSendingDomain(organizationId);
    if (!row) throw new ValidationError("Connect your domain before choosing an address on it", { localPart: ["Connect a domain first"] });
    localPart = normaliseLocalPart(patch.localPart);
    await db.update(s.sendingDomains).set({ senderLocalPart: localPart }).where(eq(s.sendingDomains.id, row.id));
  }
  if (Object.keys(values).length) await db.update(s.organizations).set(values).where(eq(s.organizations.id, organizationId));
  await audit({ action: "email.sender.update", organizationId, userId: actorId ?? null, entityType: "SETTING", entityId: organizationId, metadata: { ...values, ...(localPart ? { localPart } : {}) } });
  return senderIdentity(organizationId);
}

/** Back to Briefly's sending address, still under the workspace's name. The provider forgets the domain too, so nobody else can claim it by accident. */
export async function disconnectSendingDomain(organizationId: string, actorId?: string | null): Promise<void> {
  const row = await getSendingDomain(organizationId);
  if (!row) return;
  if (row.providerDomainId) {
    const provider = await getEmailProvider();
    await provider?.deleteDomain(row.providerDomainId).catch((err) => log.warn("provider would not remove the domain", { organizationId, err }));
  }
  await db.delete(s.sendingDomains).where(eq(s.sendingDomains.id, row.id));
  await audit({ action: "email.domain.disconnect", organizationId, userId: actorId ?? null, entityType: "SETTING", entityId: row.id, metadata: { domain: row.domainName } });
}
