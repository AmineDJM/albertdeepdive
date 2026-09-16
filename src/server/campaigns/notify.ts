import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";

export const EDITOR_ROLES = ["SUPER_ADMIN", "EDITOR_IN_CHIEF", "EDITOR"] as const;

type NotificationType = (typeof notifications.$inferInsert)["type"];
type EntityType = (typeof notifications.$inferInsert)["entityType"];

/** Active newsroom editors, plus the campus editors of `campusId` when given. */
export async function listEditors(opts: { campusId?: string | null } = {}) {
  const roleFilter = opts.campusId
    ? or(inArray(users.role, [...EDITOR_ROLES]), and(eq(users.role, "CAMPUS_EDITOR"), eq(users.campusId, opts.campusId)))
    : inArray(users.role, [...EDITOR_ROLES]);
  return db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role, campusId: users.campusId })
    .from(users)
    .where(and(eq(users.isActive, true), roleFilter));
}

export async function notifyEditors(input: {
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: EntityType;
  entityId?: string | null;
  href?: string | null;
  campusId?: string | null;
}) {
  const editors = await listEditors({ campusId: input.campusId });
  if (!editors.length) return 0;
  await db.insert(notifications).values(
    editors.map((u) => ({
      userId: u.id,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      href: input.href ?? null,
    })),
  );
  return editors.length;
}
