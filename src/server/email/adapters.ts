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

export class ResendEmailAdapter implements EmailAdapter {
  readonly name = "resend" as const;
  async send(message: OutgoingEmail): Promise<SendResult> {
    const { integrationValue } = await import("@/server/integrations/service");
    const apiKey = await integrationValue("resend", "apiKey");
    if (!apiKey) throw new Error("Resend is not connected");
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: message.to,
      cc: message.cc ? [message.cc] : undefined,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (result.error) throw new Error(result.error.message);
    return { providerMessageId: result.data?.id };
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
 * A connected Gmail mailbox always wins, because somebody went to the trouble of connecting it.
 * Then Brevo, then Resend. With none of them, messages are recorded in the in-app mailbox and go
 * nowhere — which is the right behaviour for a development install and is visible in the console.
 */
export async function resolveEmailAdapter(): Promise<EmailAdapter> {
  const { getGmailConnection } = await import("./gmail");
  if (await getGmailConnection()) return new GmailEmailAdapter();
  const { isConfigured } = await import("@/server/integrations/service");
  if (await isConfigured("brevo")) return new BrevoEmailAdapter();
  if (await isConfigured("resend")) return new ResendEmailAdapter();
  return new LogEmailAdapter();
}

