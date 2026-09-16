import { env } from "@/server/env";

export type OutgoingEmail = { to: string; subject: string; html: string; text?: string; cc?: string; replyTo?: string };
export type SendResult = { providerMessageId?: string };

export interface EmailAdapter {
  readonly name: "gmail" | "resend" | "log";
  send(message: OutgoingEmail): Promise<SendResult>;
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
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    const { Resend } = await import("resend");
    const resend = new Resend(env.RESEND_API_KEY);
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
 * Picks the adapter for each message, at send time rather than once at boot: connecting Gmail in
 * the interface has to take effect immediately, without a restart.
 *
 * A connected Gmail mailbox always wins. Otherwise Resend is used when an API key is configured,
 * and otherwise messages are only recorded in the development mailbox.
 */
export async function resolveEmailAdapter(): Promise<EmailAdapter> {
  const { getGmailConnection } = await import("./gmail");
  if (await getGmailConnection()) return new GmailEmailAdapter();
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) return new ResendEmailAdapter();
  return new LogEmailAdapter();
}

