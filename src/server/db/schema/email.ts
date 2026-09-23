import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sendingDomainStatusEnum } from "./enums";
import { organizations, users } from "./identity";
import { emailLog } from "./platform";

/**
 * Email delivery, from the customer's side of it.
 *
 * A workspace sends from its own domain once that domain is verified with the provider, and from
 * Briefly's shared domain until then. The provider is a detail these rows keep to themselves: the
 * customer sees a domain, a handful of DNS records and a status in plain words.
 */

/** One DNS record the customer has to publish, named both ways their DNS host might ask for it. */
export type DnsRecord = {
  /** What the record is for: SPF, DKIM, Return-Path, DMARC, Tracking. */
  kind: string;
  type: string;
  /** The name relative to the customer's zone, which is what most DNS editors want. */
  host: string;
  /** The fully qualified name, for hosts that ask for it whole. */
  fqdn: string;
  value: string;
  priority?: number;
  ttl?: string;
  /** The provider's word for this record: not_started, pending, verified, failed, temporary_failure. */
  status: string;
  /** Briefly's own lookup: is the record answering from the customer's DNS yet? */
  found?: boolean;
};

export const sendingDomains = pgTable(
  "sending_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The domain the customer typed: acme.com. */
    rootDomain: text("root_domain").notNull(),
    /** The domain mail actually leaves from: news.acme.com. A subdomain keeps the root's reputation apart. */
    domainName: text("domain_name").notNull(),
    provider: text("provider").notNull().default("resend"),
    providerDomainId: text("provider_domain_id"),
    providerRegion: text("provider_region"),
    status: sendingDomainStatusEnum("status").notNull().default("SETTING_UP"),
    records: jsonb("records").$type<DnsRecord[]>().notNull().default([]),
    /** Where the customer's DNS lives, when it can be told from the nameservers, and the door to it. */
    dnsHost: text("dns_host"),
    dnsHostUrl: text("dns_host_url"),
    /** A Domain Connect link that publishes every record in one click, when the host supports it. */
    oneClickUrl: text("one_click_url"),
    /** The part before the @ on this domain. The name and the reply address are the workspace's (`organizations`). */
    senderLocalPart: text("sender_local_part").notNull().default("newsletter"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** When the people who run the workspace were told it was ready, so they are told once. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    connectedById: uuid("connected_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("sending_domains_org_idx").on(t.organizationId), index("sending_domains_status_idx").on(t.status), index("sending_domains_provider_idx").on(t.providerDomainId)],
);

/**
 * Every delivery event the provider reported, by its own id.
 *
 * Providers deliver webhooks at least once and retry on any hiccup, so the id is the guard: an
 * event seen twice is written once and acted on once. Kept whole, because "what exactly did the
 * provider say about this bounce" is a question support gets asked.
 */
export const emailEvents = pgTable(
  "email_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerEventId: text("provider_event_id").notNull(),
    provider: text("provider").notNull().default("resend"),
    type: text("type").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    emailLogId: uuid("email_log_id").references(() => emailLog.id, { onDelete: "set null" }),
    recipient: text("recipient"),
    detail: text("detail"),
    payload: jsonb("payload").$type<unknown>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_events_provider_event_idx").on(t.provider, t.providerEventId), index("email_events_org_idx").on(t.organizationId, t.occurredAt), index("email_events_log_idx").on(t.emailLogId)],
);

export type SendingDomainRow = typeof sendingDomains.$inferSelect;
export type EmailEventRow = typeof emailEvents.$inferSelect;
