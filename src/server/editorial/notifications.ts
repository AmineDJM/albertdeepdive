import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";
import type { Role } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/action-result";

export type NotificationType = (typeof notifications.$inferInsert)["type"];
export type NotificationEntityType = NonNullable<(typeof notifications.$inferInsert)["entityType"]>;

export type NotificationInput = {
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: NotificationEntityType | null;
  entityId?: string | null;
  href?: string | null;
};

/** Creates one notification per user. Returns the number of rows written. */
export async function notifyUsers(userIds: string[], input: NotificationInput): Promise<number> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return 0;
  const rows = await db
    .insert(notifications)
    .values(ids.map((userId) => ({ userId, type: input.type, title: input.title, body: input.body ?? null, entityType: input.entityType ?? null, entityId: input.entityId ?? null, href: input.href ?? null })))
    .returning({ id: notifications.id });
  return rows.length;
}

/** Notifies every active user holding one of the roles. */
export async function notifyRole(roles: Role[], input: NotificationInput, options: { excludeUserIds?: string[] } = {}): Promise<number> {
  if (!roles.length) return 0;
  const rows = await db.select({ id: users.id }).from(users).where(and(inArray(users.role, roles), eq(users.isActive, true)));
  const exclude = new Set(options.excludeUserIds ?? []);
  return notifyUsers(
    rows.map((r) => r.id).filter((id) => !exclude.has(id)),
    input,
  );
}

export async function listNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
  return db.query.notifications.findMany({
    where: options.unreadOnly ? and(eq(notifications.userId, userId), isNull(notifications.readAt)) : eq(notifications.userId, userId),
    orderBy: [desc(notifications.createdAt)],
    limit: options.limit ?? 50,
  });
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

export async function markRead(notificationId: string, userId: string) {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError("Notification");
  return row;
}

export async function markAllRead(userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}
