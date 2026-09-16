import { env } from "@/server/env";

export type OutgoingEmail = { to: string; subject: string; html: string; text?: string; cc?: string; replyTo?: string };
export type SendResult = { providerMessageId?: string };

export interface EmailAdapter {
  readonly name: "resend" | "log";
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

let adapter: EmailAdapter | undefined;

export function getEmailAdapter(): EmailAdapter {
  if (adapter) return adapter;
  adapter = env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY ? new ResendEmailAdapter() : new LogEmailAdapter();
  return adapter;
}
