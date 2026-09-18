/**
 * What an email provider is, to Briefly.
 *
 * Sending is the obvious half. The other half is what makes a customer's own domain possible:
 * registering a domain with the provider, reading the DNS records it wants published, asking it to
 * look again, and hearing back — by webhook — about what happened to each message. Everything
 * business-shaped (subscribers, consent, campaigns, the log) stays in Briefly; the provider is
 * the pipe, and this interface is the whole of what Briefly asks of it.
 */

export type ProviderName = "resend";

export type ProviderRecord = {
  /** The provider's category for the record: SPF, DKIM, Tracking… */
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
  ttl?: string;
  status: string;
};

export type ProviderDomain = {
  id: string;
  name: string;
  /** The provider's word: not_started, pending, verified, failed, temporary_failure, partially_* … */
  status: string;
  region?: string;
  records: ProviderRecord[];
};

export type ProviderMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string;
  replyTo?: string;
  /** Bulk mail must offer one-click unsubscribe, or inboxes treat it as spam. */
  listUnsubscribeUrl?: string;
  /** Labels that come back on every webhook, so an event finds its workspace without guessing. */
  tags?: Record<string, string>;
};

export type DeliveryEventKind = "sent" | "delivered" | "delayed" | "bounced" | "complained" | "opened" | "clicked" | "failed" | "suppressed" | "domain" | "other";

/** One thing the provider reported, translated out of its vocabulary. */
export type DeliveryEvent = {
  /** The provider's own id for the delivery: seen twice, acted on once. */
  id: string;
  type: string;
  kind: DeliveryEventKind;
  providerMessageId: string | null;
  providerDomainId: string | null;
  recipients: string[];
  occurredAt: Date;
  detail: string | null;
  /** A bounce that will not resolve itself: the address is gone, or the provider gave up. */
  permanent: boolean;
  raw: unknown;
};

export interface EmailProvider {
  readonly name: ProviderName;
  send(message: ProviderMessage): Promise<{ providerMessageId?: string }>;
  createDomain(name: string, options?: { region?: string }): Promise<ProviderDomain>;
  getDomain(id: string): Promise<ProviderDomain>;
  /** Ask the provider to look at the DNS again. Resolves when the check has been *started*. */
  verifyDomain(id: string): Promise<void>;
  deleteDomain(id: string): Promise<void>;
  listDomains(): Promise<ProviderDomain[]>;
  createWebhook(endpoint: string, events: string[]): Promise<{ id: string; secret: string }>;
  listWebhooks(): Promise<{ id: string; endpoint: string; events: string[]; secret: string | null }[]>;
  getWebhook(id: string): Promise<{ id: string; endpoint: string; events: string[]; secret: string | null }>;
}
