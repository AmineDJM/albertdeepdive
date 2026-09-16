import { db, type Tx } from "@/server/db/client";
import { auditLog, editorialDecisions } from "@/server/db/schema";
import { createLogger } from "@/server/logger";

const log = createLogger("audit");

type EntityType = (typeof auditLog.$inferInsert)["entityType"];

export async function audit(
  entry: {
    action: string;
    userId?: string | null;
    actorType?: "USER" | "SYSTEM" | "AI" | "CONTRIBUTOR";
    entityType?: EntityType;
    entityId?: string | null;
    editionId?: string | null;
    metadata?: Record<string, unknown>;
    ipHash?: string | null;
  },
  tx?: Tx,
) {
  const executor = tx ?? db;
  try {
    await executor.insert(auditLog).values({
      action: entry.action,
      userId: entry.userId ?? null,
      actorType: entry.actorType ?? (entry.userId ? "USER" : "SYSTEM"),
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      editionId: entry.editionId ?? null,
      metadata: entry.metadata ?? {},
      ipHash: entry.ipHash ?? null,
    });
  } catch (err) {
    log.error("audit write failed", { err, action: entry.action });
  }
}

export async function recordDecision(
  entry: {
    editionId?: string | null;
    entityType: NonNullable<EntityType>;
    entityId: string;
    decision: string;
    reason?: string | null;
    previousValue?: unknown;
    newValue?: unknown;
    userId?: string | null;
  },
  tx?: Tx,
) {
  const executor = tx ?? db;
  await executor.insert(editorialDecisions).values({
    editionId: entry.editionId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    decision: entry.decision,
    reason: entry.reason ?? null,
    previousValue: entry.previousValue ?? null,
    newValue: entry.newValue ?? null,
    userId: entry.userId ?? null,
  });
  await audit(
    { action: `decision.${entry.decision.toLowerCase()}`, userId: entry.userId, entityType: entry.entityType, entityId: entry.entityId, editionId: entry.editionId, metadata: { reason: entry.reason ?? undefined } },
    tx,
  );
}
