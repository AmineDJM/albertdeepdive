import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { emailLog } from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { resolveEmailAdapter } from "./adapters";
import { senderFor } from "./sender";
import { emailTextFallback, renderEmailLayout, type EmailLayoutInput } from "./template";

const log = createLogger("email");

type EntityType = (typeof emailLog.$inferInsert)["entityType"];

export type SendEmailInput = {
  to: string;
  subject: string;
  layout: EmailLayoutInput;
  template: string;
  cc?: string;
  replyTo?: string;
  entityType?: EntityType;
  entityId?: string | null;
  editionId?: string | null;
  contributorId?: string | null;
  organizationId?: string | null;
  /** Bulk mail only: the one-click unsubscribe address for this recipient. */
  listUnsubscribeUrl?: string;
};

/** Renders, logs and sends an email. Never throws on provider failure: the log row records the error. */
export async function sendEmail(input: SendEmailInput) {
  const html = renderEmailLayout(input.layout);
  const text = emailTextFallback(input.layout);
  // Who it is from is the workspace's business — its own domain once verified, Briefly's shared one
  // until then — and only the delivery provider can honour that; a mailbox sends as itself.
  const [adapter, sender] = await Promise.all([resolveEmailAdapter(), senderFor(input.organizationId ?? null)]);
  const from = adapter.name === "resend" ? sender.from : null;
  const [row] = await db
    .insert(emailLog)
    .values({
      to: input.to,
      cc: input.cc ?? null,
      subject: input.subject,
      html,
      textBody: text,
      template: input.template,
      organizationId: input.organizationId ?? null,
      status: "QUEUED",
      provider: adapter.name,
      fromAddress: from,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      editionId: input.editionId ?? null,
      contributorId: input.contributorId ?? null,
    })
    .returning();
  try {
    const result = await adapter.send({
      to: input.to,
      cc: input.cc,
      from: from ?? undefined,
      replyTo: input.replyTo ?? (adapter.name === "resend" ? sender.replyTo : undefined),
      subject: input.subject,
      html,
      text,
      listUnsubscribeUrl: input.listUnsubscribeUrl,
      tags: { workspace: input.organizationId ?? "platform", template: input.template },
    });
    await db
      .update(emailLog)
      .set({ status: adapter.name === "log" ? "LOGGED" : "SENT", providerMessageId: result.providerMessageId ?? null, sentAt: new Date() })
      .where(eq(emailLog.id, row.id));
    log.info("email sent", { template: input.template, to: input.to, provider: adapter.name });
    return { ok: true as const, id: row.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(emailLog).set({ status: "FAILED", error: message }).where(eq(emailLog.id, row.id));
    log.error("email failed", { template: input.template, to: input.to, err });
    return { ok: false as const, id: row.id, error: message };
  }
}

export { renderEmailLayout, emailTextFallback } from "./template";
export type { EmailLayoutInput, EmailBlock } from "./template";
