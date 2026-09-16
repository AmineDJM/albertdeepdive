import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, editions, editorialDecisions, emailLog, users } from "@/server/db/schema";

export type AuditFilters = { action?: string; entityType?: string; userId?: string; editionId?: string; q?: string };

export type AuditRow = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  userName: string | null;
  editionLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

/**
 * A decision an editor had to justify: resolving a factual conflict, overriding a quality gate,
 * restoring a revision. The audit log records that something happened; this records why.
 */
export type DecisionRow = {
  id: string;
  decision: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  userName: string | null;
  editionLabel: string | null;
  previousValue: unknown;
  newValue: unknown;
  createdAt: Date;
};

export async function listDecisions(filters: { editionId?: string } = {}, limit = 60): Promise<DecisionRow[]> {
  const rows = await db
    .select({
      id: editorialDecisions.id,
      decision: editorialDecisions.decision,
      entityType: editorialDecisions.entityType,
      entityId: editorialDecisions.entityId,
      reason: editorialDecisions.reason,
      userName: users.name,
      editionLabel: editions.label,
      previousValue: editorialDecisions.previousValue,
      newValue: editorialDecisions.newValue,
      createdAt: editorialDecisions.createdAt,
    })
    .from(editorialDecisions)
    .leftJoin(users, eq(users.id, editorialDecisions.userId))
    .leftJoin(editions, eq(editions.id, editorialDecisions.editionId))
    .where(filters.editionId ? eq(editorialDecisions.editionId, filters.editionId) : undefined)
    .orderBy(desc(editorialDecisions.createdAt))
    .limit(limit);
  return rows as DecisionRow[];
}

/** The decision trail: who did what, to which entity, and why. Newest first. */
export async function listAudit(filters: AuditFilters = {}, limit = 100): Promise<AuditRow[]> {
  const where: SQL[] = [];
  if (filters.action) where.push(eq(auditLog.action, filters.action));
  if (filters.entityType) where.push(eq(auditLog.entityType, filters.entityType as typeof auditLog.entityType._.data));
  if (filters.userId) where.push(eq(auditLog.userId, filters.userId));
  if (filters.editionId) where.push(eq(auditLog.editionId, filters.editionId));
  if (filters.q?.trim()) where.push(ilike(auditLog.action, `%${filters.q.trim()}%`));
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      userName: users.name,
      editionLabel: editions.label,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(editions, eq(editions.id, auditLog.editionId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows as AuditRow[];
}

export async function auditFacets() {
  const [actions, entityTypes, people, total] = await Promise.all([
    db.selectDistinct({ v: auditLog.action }).from(auditLog).orderBy(auditLog.action),
    db.selectDistinct({ v: auditLog.entityType }).from(auditLog),
    db.select({ id: users.id, name: users.name }).from(users).orderBy(users.name),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog),
  ]);
  return {
    actions: actions.map((a) => a.v).filter(Boolean) as string[],
    entityTypes: entityTypes.map((e) => e.v).filter(Boolean) as string[],
    people,
    total: total[0]?.n ?? 0,
  };
}

export type MailFilters = { template?: string; status?: string; editionId?: string; q?: string };

export type MailRow = {
  id: string;
  to: string;
  subject: string;
  html: string;
  template: string | null;
  status: string;
  provider: string | null;
  error: string | null;
  editionLabel: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

/**
 * The development mailbox. With EMAIL_PROVIDER=log nothing leaves the building, so this is where
 * you read what a contributor would have received — including their personal link.
 */
export async function listMail(filters: MailFilters = {}, limit = 60): Promise<MailRow[]> {
  const where: SQL[] = [];
  if (filters.template) where.push(eq(emailLog.template, filters.template));
  if (filters.status) where.push(eq(emailLog.status, filters.status as typeof emailLog.status._.data));
  if (filters.editionId) where.push(eq(emailLog.editionId, filters.editionId));
  if (filters.q?.trim()) {
    const q = `%${filters.q.trim()}%`;
    where.push(or(ilike(emailLog.to, q), ilike(emailLog.subject, q)) as SQL);
  }
  const rows = await db
    .select({
      id: emailLog.id,
      to: emailLog.to,
      subject: emailLog.subject,
      html: emailLog.html,
      template: emailLog.template,
      status: emailLog.status,
      provider: emailLog.provider,
      error: emailLog.error,
      editionLabel: editions.label,
      sentAt: emailLog.sentAt,
      createdAt: emailLog.createdAt,
    })
    .from(emailLog)
    .leftJoin(editions, eq(editions.id, emailLog.editionId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(emailLog.createdAt))
    .limit(limit);
  return rows as MailRow[];
}

export async function mailFacets() {
  const [templates, statuses, counts] = await Promise.all([
    db.selectDistinct({ v: emailLog.template }).from(emailLog),
    db.selectDistinct({ v: emailLog.status }).from(emailLog),
    db.select({ status: emailLog.status, n: sql<number>`count(*)::int` }).from(emailLog).groupBy(emailLog.status),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  return {
    templates: templates.map((t) => t.v).filter(Boolean) as string[],
    statuses: statuses.map((s) => s.v).filter(Boolean) as string[],
    total: counts.reduce((n, c) => n + c.n, 0),
    failed: byStatus.FAILED ?? 0,
  };
}
