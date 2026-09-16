/**
 * Audit log reads.
 */
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, editions, users } from "@/server/db/schema";

const ACTOR_TYPES = ["USER", "SYSTEM", "AI", "CONTRIBUTOR"] as const;
type ActorType = (typeof ACTOR_TYPES)[number];

export type AuditFilters = { actorType?: string; action?: string; entityType?: string; editionId?: string; from?: string; to?: string; q?: string };

function parseDay(value: string | undefined, endOfDay = false): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function listAuditLog(filters: AuditFilters = {}, limit = 200) {
  const where: SQL[] = [];
  if (filters.actorType && (ACTOR_TYPES as readonly string[]).includes(filters.actorType)) where.push(eq(auditLog.actorType, filters.actorType as ActorType));
  if (filters.action) where.push(ilike(auditLog.action, `${filters.action}%`));
  if (filters.entityType) where.push(sql`${auditLog.entityType}::text = ${filters.entityType}`);
  if (filters.editionId) where.push(eq(auditLog.editionId, filters.editionId));
  const from = parseDay(filters.from);
  const to = parseDay(filters.to, true);
  if (from) where.push(gte(auditLog.createdAt, from));
  if (to) where.push(lte(auditLog.createdAt, to));
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    where.push(or(ilike(auditLog.action, like), ilike(users.name, like), ilike(users.email, like), sql`${auditLog.metadata}::text ilike ${like}`, sql`${auditLog.entityId}::text ilike ${like}`)!);
  }
  const rows = await db
    .select({
      id: auditLog.id,
      actorType: auditLog.actorType,
      userId: auditLog.userId,
      userName: users.name,
      userEmail: users.email,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      editionId: auditLog.editionId,
      editionLabel: editions.label,
      metadata: auditLog.metadata,
      ipHash: auditLog.ipHash,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(editions, eq(editions.id, auditLog.editionId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  return rows;
}

export type AuditRow = Awaited<ReturnType<typeof listAuditLog>>[number];

export async function auditFilterOptions() {
  const prefixes = await db
    .selectDistinct({ prefix: sql<string>`split_part(${auditLog.action}, '.', 1)` })
    .from(auditLog)
    .orderBy(sql`split_part(${auditLog.action}, '.', 1)`);
  const entityTypes = await db
    .selectDistinct({ entityType: sql<string | null>`${auditLog.entityType}::text` })
    .from(auditLog)
    .orderBy(sql`${auditLog.entityType}::text`);
  const [counts] = await db
    .select({ total: sql<number>`count(*)`, last24h: sql<number>`count(*) filter (where ${auditLog.createdAt} > now() - interval '24 hours')`, users: sql<number>`count(distinct ${auditLog.userId})` })
    .from(auditLog);
  return {
    actionPrefixes: prefixes.map((p) => p.prefix).filter(Boolean),
    entityTypes: entityTypes.map((e) => e.entityType).filter((e): e is string => !!e),
    total: Number(counts?.total ?? 0),
    last24h: Number(counts?.last24h ?? 0),
    actors: Number(counts?.users ?? 0),
  };
}
