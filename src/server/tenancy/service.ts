import { and, asc, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { organizationMembers, organizations, publications, users } from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { slugify } from "@/lib/utils";
import { audit } from "@/server/audit";
import type { OrganizationRole } from "./context";
import { requireLimit } from "@/server/billing/entitlements";

export const organizationTypes = ["COMPANY", "SCHOOL", "UNIVERSITY", "ASSOCIATION", "COMMUNITY", "INVESTOR", "MEDIA", "INSTITUTION", "OTHER"] as const;

export const organizationInputSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(120),
  type: z.enum(organizationTypes).default("COMPANY"),
  website: z.string().trim().url("Enter a full URL, e.g. https://acme.com").optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  description: z.string().trim().max(2000).optional(),
  locale: z.enum(["en", "fr"]).default("en"),
  timezone: z.string().trim().min(1).default("Europe/Paris"),
  country: z.string().trim().max(80).optional(),
});

export type OrganizationInput = z.input<typeof organizationInputSchema>;

/** Slugs are the public handle of a workspace, so they must stay unique platform-wide. */
async function uniqueOrganizationSlug(name: string, excludeId?: string) {
  const base = slugify(name) || "workspace";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const clash = await db.query.organizations.findFirst({
      where: excludeId ? and(eq(organizations.slug, candidate), ne(organizations.id, excludeId)) : eq(organizations.slug, candidate),
      columns: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Create a workspace and make its creator the owner. This is the one place a workspace comes into
 * existence — onboarding, the super-admin console and the tests all go through it, so the invariant
 * "every organisation has at least one OWNER" cannot be broken by a new caller forgetting it.
 */
export async function createOrganization(raw: OrganizationInput, ownerUserId: string) {
  const input = organizationInputSchema.parse(raw);
  const slug = await uniqueOrganizationSlug(input.name);
  const owner = await db.query.users.findFirst({ where: eq(users.id, ownerUserId), columns: { id: true } });
  if (!owner) throw new NotFoundError("User");

  const org = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(organizations)
      .values({
        name: input.name,
        slug,
        type: input.type,
        website: input.website ?? null,
        description: input.description ?? null,
        locale: input.locale,
        timezone: input.timezone,
        country: input.country ?? null,
        createdById: ownerUserId,
      })
      .returning();
    // A user's first workspace is the one they land in; later ones do not steal the default.
    const [{ existing }] = await tx.select({ existing: count() }).from(organizationMembers).where(eq(organizationMembers.userId, ownerUserId));
    await tx.insert(organizationMembers).values({
      organizationId: row.id,
      userId: ownerUserId,
      role: "OWNER",
      isDefault: Number(existing) === 0,
      acceptedAt: new Date(),
    });
    return row;
  });

  await audit({ action: "organization.create", userId: ownerUserId, entityId: org.id, metadata: { name: org.name, slug: org.slug, type: org.type } });
  return org;
}

export async function updateOrganization(organizationId: string, raw: Partial<OrganizationInput> & { brandColours?: Record<string, unknown>; links?: Record<string, unknown>; logoUrl?: string | null; faviconUrl?: string | null }, userId?: string | null) {
  const input = organizationInputSchema.partial().parse(raw);
  const patch: Record<string, unknown> = { ...input };
  if (input.name) patch.slug = await uniqueOrganizationSlug(input.name, organizationId);
  if (raw.brandColours !== undefined) patch.brandColours = raw.brandColours;
  if (raw.links !== undefined) patch.links = raw.links;
  if (raw.logoUrl !== undefined) patch.logoUrl = raw.logoUrl;
  if (raw.faviconUrl !== undefined) patch.faviconUrl = raw.faviconUrl;

  const [row] = await db.update(organizations).set(patch).where(eq(organizations.id, organizationId)).returning();
  if (!row) throw new NotFoundError("Workspace");
  await audit({ action: "organization.update", userId, entityId: organizationId, metadata: { fields: Object.keys(patch) } });
  return row;
}

export async function getOrganization(organizationId: string) {
  const row = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  if (!row) throw new NotFoundError("Workspace");
  return row;
}

export async function listOrganizations() {
  const rows = await db.select().from(organizations).orderBy(asc(organizations.name));
  const memberCounts = await db.select({ organizationId: organizationMembers.organizationId, n: count() }).from(organizationMembers).groupBy(organizationMembers.organizationId);
  const publicationCounts = await db.select({ organizationId: publications.organizationId, n: count() }).from(publications).groupBy(publications.organizationId);
  const members = new Map(memberCounts.map((r) => [r.organizationId, Number(r.n)]));
  const pubs = new Map(publicationCounts.map((r) => [r.organizationId, Number(r.n)]));
  return rows.map((r) => ({ ...r, members: members.get(r.id) ?? 0, publications: pubs.get(r.id) ?? 0 }));
}

export async function listMembers(organizationId: string) {
  return db
    .select({
      id: organizationMembers.id,
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      platformRole: users.role,
      role: organizationMembers.role,
      isDefault: organizationMembers.isDefault,
      acceptedAt: organizationMembers.acceptedAt,
      createdAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, organizationId))
    .orderBy(asc(users.name));
}

export async function addMember(organizationId: string, userId: string, role: OrganizationRole = "VIEWER", invitedById?: string | null) {
  const existing = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)),
  });
  // Re-adding somebody who is already here costs no seat, so the limit is only checked for new ones.
  if (existing) return existing;
  await requireLimit(organizationId, "users");
  const [{ has }] = await db.select({ has: count() }).from(organizationMembers).where(eq(organizationMembers.userId, userId));
  const [row] = await db
    .insert(organizationMembers)
    .values({ organizationId, userId, role, invitedById: invitedById ?? null, invitedAt: new Date(), acceptedAt: new Date(), isDefault: Number(has) === 0 })
    .returning();
  await audit({ action: "organization.member.add", userId: invitedById, entityId: organizationId, metadata: { memberId: userId, role } });
  return row;
}

export async function setMemberRole(organizationId: string, userId: string, role: OrganizationRole, actorId?: string | null) {
  // A workspace without an owner can never be administered again, so the last one cannot be demoted.
  if (role !== "OWNER") {
    const owners = await db
      .select({ n: count() })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.role, "OWNER")));
    const target = await db.query.organizationMembers.findFirst({
      where: and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)),
    });
    if (target?.role === "OWNER" && Number(owners[0]?.n ?? 0) <= 1) {
      throw new ValidationError("This workspace needs at least one owner", { role: ["Promote another member first"] });
    }
  }
  const [row] = await db
    .update(organizationMembers)
    .set({ role })
    .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError("Member");
  await audit({ action: "organization.member.role", userId: actorId, entityId: organizationId, metadata: { memberId: userId, role } });
  return row;
}

export async function removeMember(organizationId: string, userId: string, actorId?: string | null) {
  const target = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)),
  });
  if (!target) throw new NotFoundError("Member");
  if (target.role === "OWNER") {
    const owners = await db
      .select({ n: count() })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.role, "OWNER")));
    if (Number(owners[0]?.n ?? 0) <= 1) throw new ValidationError("This workspace needs at least one owner");
  }
  await db.delete(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
  await audit({ action: "organization.member.remove", userId: actorId, entityId: organizationId, metadata: { memberId: userId } });
}
