import { env } from "@/server/env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string;
  replyTo?: string;
  /** Bulk mail must offer one-click unsubscribe, or inboxes treat it as spam. */
  listUnsubscribeUrl?: string;
  /** Who it is from, resolved per workspace. Adapters with a fixed identity (a mailbox) ignore it. */
  from?: string;
  /** Labels the provider hands back on every webhook. */
  tags?: Record<string, string>;
};
export type SendResult = { providerMessageId?: string };

export interface EmailAdapter {
  readonly name: "gmail" | "brevo" | "resend" | "log";
  send(message: OutgoingEmail): Promise<SendResult>;
}

/** Splits "Name <a@b.c>" into the two fields providers want separately. */
function parseFrom(from: string): { email: string; name?: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return match ? { name: match[1].replace(/^"|"$/g, "") || undefined, email: match[2] } : { email: from.trim() };
}

/** Development adapter: emails are stored in the email_log table and viewable in the UI mailbox. */
export class LogEmailAdapter implements EmailAdapter {
  readonly name = "log" as const;
  async send(): Promise<SendResult> {
    return { providerMessageId: `log-${Date.now()}` };
  }
}

/**
 * Resend, Briefly's delivery layer, through the provider interface. The sender is decided upstream
 * per workspace — the customer's own domain once it is verified, Briefly's shared domain until then.
 */
export class ResendEmailAdapter implements EmailAdapter {
  readonly name = "resend" as const;
  async send(message: OutgoingEmail): Promise<SendResult> {
    const { getEmailProvider } = await import("./providers");
    const provider = await getEmailProvider();
    if (!provider) throw new Error("Resend is not connected");
    return provider.send({ ...message, from: message.from ?? env.EMAIL_FROM });
  }
}

/**
 * Brevo, over its plain HTTPS API rather than its SDK: one fetch, no dependency, and the failure
 * modes are visible. Their API returns a message id we keep, so a bounce webhook can be traced back
 * to the row in `email_log` that sent it.
 */
export class BrevoEmailAdapter implements EmailAdapter {
  readonly name = "brevo" as const;
  async send(message: OutgoingEmail): Promise<SendResult> {
    const { integrationConfig } = await import("@/server/integrations/service");
    const config = await integrationConfig("brevo");
    if (!config.apiKey) throw new Error("Brevo is not connected");
    const sender = parseFrom(config.from || env.EMAIL_FROM);
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender,
        to: [{ email: message.to }],
        cc: message.cc ? [{ email: message.cc }] : undefined,
        replyTo: message.replyTo ? { email: message.replyTo } : undefined,
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        headers: message.listUnsubscribeUrl
          ? { "List-Unsubscribe": `<${message.listUnsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
          : undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Brevo responded ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { messageId?: string };
    return { providerMessageId: data.messageId };
  }
}

/**
 * Sends through the Gmail mailbox connected in Settings. Nothing is configured in the environment:
 * the address and its app password are entered in the interface and encrypted in the database.
 */
export class GmailEmailAdapter implements EmailAdapter {
  readonly name = "gmail" as const;
  async send(message: OutgoingEmail): Promise<SendResult> {
    const { sendThroughGmail } = await import("./gmail");
    return sendThroughGmail(message);
  }
}

/**
 * Picks the adapter for each message, at send time rather than once at boot: connecting a provider
 * in the interface has to take effect immediately, without a restart.
 *
 * Resend is the delivery layer, and wins whenever it is connected: it is the one path that can send
 * as each customer's own domain. Without it, a connected Gmail mailbox sends (somebody went to the
 * trouble of connecting it), then Brevo. With none of them, messages are recorded in the in-app
 * mailbox and go nowhere — the right behaviour for a development install, and visible in the console.
 */
export async function resolveEmailAdapter(): Promise<EmailAdapter> {
  const { isConfigured } = await import("@/server/integrations/service");
  if (await isConfigured("resend")) return new ResendEmailAdapter();
  const { getGmailConnection } = await import("./gmail");
  if (await getGmailConnection()) return new GmailEmailAdapter();
  if (await isConfigured("brevo")) return new BrevoEmailAdapter();
  return new LogEmailAdapter();
}

