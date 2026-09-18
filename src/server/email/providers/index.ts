import type { EmailProvider } from "./types";
import { ResendProvider } from "./resend";

/**
 * The provider Briefly delivers through, resolved on every call so a key pasted into the console
 * takes effect at once. Tests hand in a stand-in and never reach a network.
 */

let override: EmailProvider | null = null;

export function setEmailProviderForTests(provider: EmailProvider | null) {
  override = provider;
}

/** The configured provider, or null when none is: Briefly then falls back to a mailbox, Brevo or the log. */
export async function getEmailProvider(): Promise<EmailProvider | null> {
  if (override) return override;
  const { integrationValue } = await import("@/server/integrations/service");
  const apiKey = await integrationValue("resend", "apiKey");
  return apiKey ? new ResendProvider(apiKey) : null;
}

export type { EmailProvider, ProviderDomain, ProviderMessage, DeliveryEvent } from "./types";
