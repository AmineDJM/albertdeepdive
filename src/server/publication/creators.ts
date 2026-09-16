import { inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";

/** Maps user ids to display names in one query, for lists that only store `createdById`. */
export async function creatorNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}
