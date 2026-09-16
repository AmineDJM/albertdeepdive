/**
 * Dev mailbox: everything that went through `sendEmail` lives in `email_log`.
 */
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contributors, editions, emailLog } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { NotFoundError } from "@/lib/action-result";

export type MailboxFilters = { status?: string; template?: string; editionId?: string; q?: string };

const EMAIL_STATUSES = ["QUEUED", "SENT", "FAILED", "LOGGED"] as const;

export async function listEmails(filters: MailboxFilters = {}, limit = 150) {
  const where: SQL[] = [];
  if (filters.status && (EMAIL_STATUSES as readonly string[]).includes(filters.status)) where.push(eq(emailLog.status, filters.status as (typeof EMAIL_STATUSES)[number]));
  if (filters.template) where.push(eq(emailLog.template, filters.template));
  if (filters.editionId) where.push(eq(emailLog.editionId, filters.editionId));
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    where.push(or(ilike(emailLog.to, like), ilike(emailLog.subject, like), ilike(contributors.firstName, like), ilike(contributors.lastName, like))!);
  }
  const rows = await db
    .select({
      id: emailLog.id,
      to: emailLog.to,
      cc: emailLog.cc,
      subject: emailLog.subject,
      template: emailLog.template,
      status: emailLog.status,
      provider: emailLog.provider,
      error: emailLog.error,
      sentAt: emailLog.sentAt,
      createdAt: emailLog.createdAt,
      editionId: emailLog.editionId,
      editionLabel: editions.label,
      contributorId: emailLog.contributorId,
      contributorName: sql<string | null>`case when ${contributors.id} is null then null else ${contributors.firstName} || ' ' || ${contributors.lastName} end`,
      entityType: emailLog.entityType,
      entityId: emailLog.entityId,
    })
    .from(emailLog)
    .leftJoin(editions, eq(editions.id, emailLog.editionId))
    .leftJoin(contributors, eq(contributors.id, emailLog.contributorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(emailLog.createdAt))
    .limit(limit);
  return rows;
}

export type MailboxRow = Awaited<ReturnType<typeof listEmails>>[number];

export async function mailboxSummary() {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)`,
      sent: sql<number>`count(*) filter (where ${emailLog.status} in ('SENT', 'LOGGED'))`,
      failed: sql<number>`count(*) filter (where ${emailLog.status} = 'FAILED')`,
      queued: sql<number>`count(*) filter (where ${emailLog.status} = 'QUEUED')`,
      last24h: sql<number>`count(*) filter (where ${emailLog.createdAt} > now() - interval '24 hours')`,
    })
    .from(emailLog);
  const templates = await db.selectDistinct({ template: emailLog.template }).from(emailLog).orderBy(emailLog.template);
  return {
    total: Number(counts?.total ?? 0),
    sent: Number(counts?.sent ?? 0),
    failed: Number(counts?.failed ?? 0),
    queued: Number(counts?.queued ?? 0),
    last24h: Number(counts?.last24h ?? 0),
    templates: templates.map((t) => t.template).filter((t): t is string => !!t),
  };
}

export async function getEmail(id: string) {
  const [row] = await db
    .select({ email: emailLog, editionLabel: editions.label, contributorName: sql<string | null>`case when ${contributors.id} is null then null else ${contributors.firstName} || ' ' || ${contributors.lastName} end` })
    .from(emailLog)
    .leftJoin(editions, eq(editions.id, emailLog.editionId))
    .leftJoin(contributors, eq(contributors.id, emailLog.contributorId))
    .where(eq(emailLog.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("Email");
  return { ...row.email, editionLabel: row.editionLabel, contributorName: row.contributorName };
}

/** Sends a sample email to the current user so the layout and the provider can be checked end to end. */
export async function sendTestEmail(user: { id: string; email: string; name: string }) {
  const result = await sendEmail({
    to: user.email,
    subject: "Test email — Albert Deep Dive mailbox",
    template: "mailbox_test",
    entityType: "USER",
    entityId: user.id,
    layout: {
      preheader: "If you can read this, the email pipeline works.",
      kicker: "Mailbox test",
      title: `Hello ${user.name.split(" ")[0] ?? ""}, the newsroom can reach you`,
      blocks: [
        { type: "paragraph", text: "This message was sent from Settings → Mailbox to check the email layout and the configured provider." },
        { type: "kv", rows: [{ label: "Provider", value: env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY ? "Resend" : "Dev mailbox (log)" }, { label: "From", value: env.EMAIL_FROM }, { label: "Sent at", value: new Date().toISOString() }] },
        { type: "callout", title: "Contribution requests look like this", text: "Personal links, a deadline and one clear call to action. Nothing else." },
        { type: "list", items: ["Invitation on Day 1", "Reminder #1 on Day 4", "Reminder #2 on Day 7", "Grace period until Day 8"] },
      ],
      cta: { label: "Open the newsroom", url: `${env.NEXT_PUBLIC_APP_URL}/overview` },
      secondaryCta: { label: "Mailbox", url: `${env.NEXT_PUBLIC_APP_URL}/settings/mailbox` },
    },
  });
  await audit({ action: "mailbox.test_email", userId: user.id, entityType: "USER", entityId: user.id, metadata: { ok: result.ok, emailId: result.id } });
  return result;
}
