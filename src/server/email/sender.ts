import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import { BRAND } from "@/lib/brand";

/**
 * Whose name is on the envelope.
 *
 * A workspace with a verified domain sends as itself: "Acme <newsletter@news.acme.com>". Until
 * then it sends as "Acme via Briefly" from Briefly's shared domain — real mail that really
 * arrives, plainly marked as not yet theirs — so nothing about onboarding or a first edition waits
 * on DNS. Platform mail (receipts, reminders) is Briefly's own.
 */

export type SenderMode = "domain" | "test" | "platform";

export type Sender = {
  from: string;
  name: string;
  address: string;
  replyTo?: string;
  mode: SenderMode;
  /** The customer's domain when it is theirs, null otherwise. */
  domain: string | null;
};

export type DeliveryConfig = {
  configured: boolean;
  sharedDomain: string | null;
  region: string;
  domainConnect: { providerId: string; serviceId: string } | null;
};

export const PREVIEW_LOCAL_PART = "preview";
export const PLATFORM_LOCAL_PART = "notifications";

/** "Name <address>", with the name quoted when it holds anything a header would misread. */
export function formatSender(name: string, address: string): string {
  const clean = name.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return address;
  return `${/^[A-Za-z0-9 .'&-]+$/.test(clean) ? clean : `"${clean}"`} <${address}>`;
}

export function parseSender(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match ? { name: match[1].replace(/^"|"$/g, "") || undefined, email: match[2] } : { email: from.trim() };
}

/** What the platform admin connected, read on every call so the console takes effect at once. */
export async function deliveryConfig(): Promise<DeliveryConfig> {
  const { integrationConfig } = await import("@/server/integrations/service");
  const config = await integrationConfig("resend");
  const sharedDomain = config.sharedDomain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  const providerId = config.domainConnectProviderId?.trim();
  const serviceId = config.domainConnectServiceId?.trim();
  return {
    configured: Boolean(config.apiKey),
    sharedDomain,
    region: config.region?.trim() || "eu-west-1",
    domainConnect: providerId && serviceId ? { providerId, serviceId } : null,
  };
}

function platformSender(config: DeliveryConfig): Sender {
  if (config.configured && config.sharedDomain) {
    const address = `${PLATFORM_LOCAL_PART}@${config.sharedDomain}`;
    return { from: formatSender(BRAND.name, address), name: BRAND.name, address, mode: "platform", domain: null };
  }
  const parsed = parseSender(env.EMAIL_FROM);
  return { from: env.EMAIL_FROM, name: parsed.name ?? BRAND.name, address: parsed.email, mode: "platform", domain: null };
}

export async function senderFor(organizationId: string | null | undefined): Promise<Sender> {
  const config = await deliveryConfig();
  if (!organizationId) return platformSender(config);

  const [domain, organization] = await Promise.all([
    db.query.sendingDomains.findFirst({ where: eq(s.sendingDomains.organizationId, organizationId) }),
    db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { name: true } }),
  ]);
  if (domain?.status === "READY") {
    const address = `${domain.senderLocalPart}@${domain.domainName}`;
    return { from: formatSender(domain.senderName, address), name: domain.senderName, address, replyTo: domain.replyTo ?? undefined, mode: "domain", domain: domain.domainName };
  }
  if (config.configured && config.sharedDomain) {
    const name = `${organization?.name ?? BRAND.name} via ${BRAND.name}`;
    const address = `${PREVIEW_LOCAL_PART}@${config.sharedDomain}`;
    return { from: formatSender(name, address), name, address, replyTo: domain?.replyTo ?? undefined, mode: "test", domain: null };
  }
  return platformSender(config);
}
