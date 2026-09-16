import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { editorialComments, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { notifyUsers, type NotificationEntityType } from "./notifications";

export type CommentEntityType = (typeof editorialComments.$inferInsert)["entityType"];

const MENTION_RE = /@\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?/gi;

/** User ids written as `@<uuid>` (optionally `@{uuid}`) in a comment body. */
export function parseMentions(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))];
}

function hrefFor(entityType: CommentEntityType, entityId: string, editionId?: string | null): string | null {
  switch (entityType) {
    case "STORY":
      return `/stories/${entityId}`;
    case "ARTICLE":
      return `/articles/${entityId}`;
    case "SUBMISSION":
      return editionId ? `/editions/${editionId}/inbox?submission=${entityId}` : null;
    case "CLUSTER":
      return editionId ? `/editions/${editionId}/stories?cluster=${entityId}` : null;
    case "EDITION":
      return `/editions/${entityId}`;
    default:
      return null;
  }
}

/** Adds a comment; `@<userId>` mentions become MENTION notifications for existing users. */
export async function addComment(entityType: CommentEntityType, entityId: string, body: string, userId: string, editionId?: string | null) {
  const text = body.trim();
  if (!text) throw new ValidationError("Comment body is required", { body: ["Required"] });
  const author = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true, name: true } });
  if (!author) throw new NotFoundError("User");
  const candidateMentions = parseMentions(text);
  const mentioned = candidateMentions.length ? await db.select({ id: users.id }).from(users).where(and(inArray(users.id, candidateMentions), eq(users.isActive, true))) : [];
  const mentions = mentioned.map((m) => m.id);
  const [comment] = await db
    .insert(editorialComments)
    .values({ editionId: editionId ?? null, entityType, entityId, userId, body: text, mentions })
    .returning();
  const recipients = mentions.filter((id) => id !== userId);
  if (recipients.length) {
    await notifyUsers(recipients, {
      type: "MENTION",
      title: `${author.name} mentioned you`,
      body: text.length > 200 ? `${text.slice(0, 199)}…` : text,
      entityType: entityType as NotificationEntityType,
      entityId,
      href: hrefFor(entityType, entityId, editionId),
    });
  }
  await audit({ action: "comment.add", userId, entityType, entityId, editionId: editionId ?? null, metadata: { commentId: comment.id, mentions } });
  return { comment, mentions };
}

export async function resolveComment(commentId: string, userId: string) {
  const [row] = await db
    .update(editorialComments)
    .set({ resolvedAt: new Date(), resolvedById: userId })
    .where(and(eq(editorialComments.id, commentId), isNull(editorialComments.resolvedAt)))
    .returning();
  if (!row) throw new NotFoundError("Comment");
  await audit({ action: "comment.resolve", userId, entityType: row.entityType, entityId: row.entityId, editionId: row.editionId, metadata: { commentId } });
  return row;
}

export async function listComments(entityType: CommentEntityType, entityId: string, options: { includeResolved?: boolean } = {}) {
  const rows = await db.query.editorialComments.findMany({
    where: options.includeResolved === false ? and(eq(editorialComments.entityType, entityType), eq(editorialComments.entityId, entityId), isNull(editorialComments.resolvedAt)) : and(eq(editorialComments.entityType, entityType), eq(editorialComments.entityId, entityId)),
    orderBy: [asc(editorialComments.createdAt)],
    with: { user: { columns: { id: true, name: true, avatarUrl: true } } },
  });
  return rows;
}
