import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { getOwnProfile, updateOwnProfile } from "@/server/settings/users";
import { createOrganization, addMember, listMyOrganizationsDetailed } from "@/server/tenancy/service";
import { ValidationError } from "@/lib/action-result";

/**
 * A handle somebody can claim, and the list of organisations they belong to.
 *
 * `users.username` existed as a column with a unique index and was read by nothing: no screen to
 * claim one, nowhere it appeared, nothing that used it. A column nobody can fill is not a feature.
 */
describe("a person's handle", () => {
  let userId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    const admin = await db.query.users.findFirst({ where: eq(s.users.email, seeded.adminEmail) });
    userId = admin!.id;
  }, 300_000);

  it("is claimed, stored in one spelling, and read back", async () => {
    await updateOwnProfile(userId, { name: "Albert Admin", username: "  @Albert.Admin " });
    const profile = await getOwnProfile(userId);
    expect(profile.username).toBe("albert.admin");
  });

  it("is refused when somebody else already has it", async () => {
    const other = await db.insert(s.users).values({ email: `handle.${Date.now()}@example.test`, name: "Someone Else", role: "VIEWER" }).returning();
    await expect(updateOwnProfile(other[0].id, { name: "Someone Else", username: "albert.admin" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("is refused when it is not a handle at all", async () => {
    for (const username of ["ab", "settings", "amine djm", ".amine"]) {
      await expect(updateOwnProfile(userId, { name: "Albert Admin", username }), username).rejects.toBeInstanceOf(ValidationError);
    }
    // The refusal changed nothing.
    expect((await getOwnProfile(userId)).username).toBe("albert.admin");
  });

  it("can be given up by clearing the field", async () => {
    await updateOwnProfile(userId, { name: "Albert Admin", username: "" });
    expect((await getOwnProfile(userId)).username).toBeNull();
  });

  it("offers one rather than an empty box", async () => {
    const profile = await getOwnProfile(userId);
    expect(profile.suggestedUsername).toBeTruthy();
    expect(profile.suggestedUsername).toMatch(/^[a-z0-9._-]+$/);
  });
});

describe("the organisations a person belongs to", () => {
  /**
   * The workspace's own owner, not the platform's super admin.
   *
   * `seeded.adminEmail` is Briefly's staff account, which deliberately belongs to no customer —
   * so it is the wrong person to ask "which organisations are yours".
   */
  async function albertSchoolOwner() {
    await ensureSeeded();
    const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") });
    const membership = await db.query.organizationMembers.findFirst({
      where: and(eq(s.organizationMembers.organizationId, organization!.id), eq(s.organizationMembers.role, "OWNER")),
    });
    return db.query.users.findFirst({ where: eq(s.users.id, membership!.userId) });
  }

  it("lists each one with the role held in it", async () => {
    const admin = await albertSchoolOwner();
    const second = await createOrganization({ name: `Side Project ${Date.now()}`, type: "COMPANY", locale: "en", timezone: "Europe/Paris" }, admin!.id);

    const mine = await listMyOrganizationsDetailed(admin!.id);
    const side = mine.find((organization) => organization.id === second.id);
    expect(side).toBeTruthy();
    // Creating a workspace makes you its owner; that is the role the list must show.
    expect(side!.role).toBe("OWNER");
    expect(side!.members).toBeGreaterThanOrEqual(1);
    expect(mine.some((organization) => organization.name === "Albert School")).toBe(true);
    // Albert School has newsletters; the brand-new one has none, and says so rather than guessing.
    expect(mine.find((organization) => organization.name === "Albert School")!.publications).toBeGreaterThan(0);
    expect(side!.publications).toBe(0);
  });

  it("shows the role somebody was actually given, not the one the owner has", async () => {
    const admin = await albertSchoolOwner();
    const workspace = await createOrganization({ name: `Shared ${Date.now()}`, type: "COMPANY", locale: "en", timezone: "Europe/Paris" }, admin!.id);
    const guest = await db.insert(s.users).values({ email: `guest.${Date.now()}@example.test`, name: "Guest", role: "VIEWER" }).returning();
    await addMember(workspace.id, guest[0].id, "EDITOR");

    const theirs = await listMyOrganizationsDetailed(guest[0].id);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ id: workspace.id, role: "EDITOR", members: 2 });
  });

  it("does not list somebody else's workspace", async () => {
    const stranger = await db.insert(s.users).values({ email: `stranger.${Date.now()}@example.test`, name: "Stranger", role: "VIEWER" }).returning();
    expect(await listMyOrganizationsDetailed(stranger[0].id)).toEqual([]);
  });
});
