import { describe, expect, it } from "vitest";
import {
  NEWSROOM_ROLES,
  PERMISSIONS,
  ROLES,
  permissionsForRole,
  roleHasAny,
  roleHasPermission,
} from "@/lib/auth/permissions";

describe("permissions", () => {
  it("super admin has every permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("SUPER_ADMIN", p)).toBe(true);
  });
  it("editor in chief can approve and publish but not manage users or system settings", () => {
    expect(roleHasPermission("EDITOR_IN_CHIEF", "edition:approve")).toBe(true);
    expect(roleHasPermission("EDITOR_IN_CHIEF", "edition:publish")).toBe(true);
    expect(roleHasPermission("EDITOR_IN_CHIEF", "qa:override")).toBe(true);
    expect(roleHasPermission("EDITOR_IN_CHIEF", "user:manage")).toBe(false);
    expect(roleHasPermission("EDITOR_IN_CHIEF", "settings:manage")).toBe(false);
  });
  it("editors edit but never approve editions or override gates", () => {
    expect(roleHasPermission("EDITOR", "article:edit")).toBe(true);
    expect(roleHasPermission("EDITOR", "layout:edit")).toBe(true);
    expect(roleHasPermission("EDITOR", "edition:approve")).toBe(false);
    expect(roleHasPermission("EDITOR", "qa:override")).toBe(false);
    expect(roleHasPermission("EDITOR", "edition:publish")).toBe(false);
  });
  it("campus editors review submissions only", () => {
    expect(roleHasPermission("CAMPUS_EDITOR", "submission:review")).toBe(true);
    expect(roleHasPermission("CAMPUS_EDITOR", "article:edit")).toBe(false);
  });
  it("contributors cannot enter the newsroom; viewers are read only", () => {
    expect(NEWSROOM_ROLES).not.toContain("CONTRIBUTOR");
    expect(permissionsForRole("CONTRIBUTOR")).toEqual(["submission:create", "archive:view"]);
    expect(roleHasAny("VIEWER", ["edition:edit", "story:edit"])).toBe(false);
    expect(roleHasPermission("VIEWER", "edition:view")).toBe(true);
  });
  it("every role is covered", () => {
    for (const role of ROLES) expect(permissionsForRole(role).length).toBeGreaterThan(0);
  });
});
