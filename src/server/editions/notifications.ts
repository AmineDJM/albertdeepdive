import { and, desc, eq, isNull, count } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";

export async function listNotificationsForUser(userId: string, limit = 20) {
  const rows = await db.query.notifications.findMany({ where: eq(s.notifications.userId, userId), orderBy: [desc(s.notifications.createdAt)], limit });
  const [{ unread }] = await db.select({ unread: count() }).from(s.notifications).where(and(eq(s.notifications.userId, userId), isNull(s.notifications.readAt)));
  return { rows, unread: Number(unread) };
}

export async function markNotificationRead(userId: string, id: string) {
  await db.update(s.notifications).set({ readAt: new Date() }).where(and(eq(s.notifications.id, id), eq(s.notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: string) {
  await db.update(s.notifications).set({ readAt: new Date() }).where(and(eq(s.notifications.userId, userId), isNull(s.notifications.readAt)));
}
