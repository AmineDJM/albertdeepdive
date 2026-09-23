import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { emailLog } from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { resolveEmailAdapter } from "./adapters";
import { envelopeFor } from "./sender";
import { emailTextFallback, renderEmailLayout, type EmailLayoutInput } from "./template";
import { resolveMasthead } from "./masthead";

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
  /*
   * The sender's own mark, filled in here rather than trusted to each builder.
   *
   * A builder that forgets does not fail — it signs a customer's message with Briefly's logo — so
   * the decision is made once, at the only point every email passes through, from what the call
   * already carries. A layout that named its own masthead keeps it; a workspace's logo and colour
   * are added to it when it only gave a name.
   */
  const resolved = await resolveMasthead({
    organizationId: input.organizationId,
    editionId: input.editionId,
    name: input.layout.masthead?.name ?? null,
  });
  const layout: EmailLayoutInput = resolved ? { ...input.layout, masthead: { ...resolved, ...input.layout.masthead, logoUrl: input.layout.masthead?.logoUrl ?? resolved.logoUrl, colour: input.layout.masthead?.colour ?? resolved.colour } } : input.layout;
  const html = renderEmailLayout(layout);
  const text = emailTextFallback(layout);
  // Who it is from is the workspace's business: its name and reply address always, its own domain
  // once verified. Every transport carries that name — a mailbox or a single-sender provider on its
  // own address — so a customer's message never goes out under Briefly's name.
  const adapter = await resolveEmailAdapter();
  const sender = await envelopeFor(input.organizationId ?? null, adapter);
  const from = sender.from;
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
      from,
      replyTo: input.replyTo ?? sender.replyTo,
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
