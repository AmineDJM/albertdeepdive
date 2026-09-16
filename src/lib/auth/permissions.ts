export const ROLES = ["SUPER_ADMIN", "EDITOR_IN_CHIEF", "EDITOR", "CAMPUS_EDITOR", "CONTRIBUTOR", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "edition:view",
  "edition:create",
  "edition:edit",
  "edition:approve",
  "edition:publish",
  "edition:archive",
  "campaign:manage",
  "submission:view",
  "submission:review",
  "submission:create",
  "story:edit",
  "article:edit",
  "article:approve",
  "media:manage",
  "media:rights",
  "layout:edit",
  "export:run",
  "qa:override",
  "ai:run",
  "contributor:manage",
  "campus:manage",
  "section:manage",
  "prompt:manage",
  "automation:manage",
  "settings:manage",
  "user:manage",
  "analytics:view",
  "archive:view",
  "audit:view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  EDITOR_IN_CHIEF: ALL.filter((p) => p !== "user:manage" && p !== "settings:manage"),
  EDITOR: [
    "edition:view",
    "edition:create",
    "edition:edit",
    "campaign:manage",
    "submission:view",
    "submission:review",
    "submission:create",
    "story:edit",
    "article:edit",
    "media:manage",
    "media:rights",
    "layout:edit",
    "export:run",
    "ai:run",
    "contributor:manage",
    "section:manage",
    "analytics:view",
    "archive:view",
    "audit:view",
  ],
  CAMPUS_EDITOR: ["edition:view", "submission:view", "submission:review", "submission:create", "media:manage", "analytics:view", "archive:view"],
  CONTRIBUTOR: ["submission:create", "archive:view"],
  VIEWER: ["edition:view", "archive:view", "analytics:view"],
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function roleHasAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => roleHasPermission(role, p));
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super admin",
  EDITOR_IN_CHIEF: "Editor in chief",
  EDITOR: "Editor",
  CAMPUS_EDITOR: "Campus editor",
  CONTRIBUTOR: "Contributor",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  SUPER_ADMIN: "System configuration, users, everything.",
  EDITOR_IN_CHIEF: "Approves editions, overrides quality gates, publishes.",
  EDITOR: "Runs campaigns, edits stories and articles, lays out pages, exports drafts.",
  CAMPUS_EDITOR: "Reviews submissions and media for their campus.",
  CONTRIBUTOR: "Submits content only.",
  VIEWER: "Read-only access to editions, archive and analytics.",
};

/** Roles that can access the newsroom workbench at all. */
export const NEWSROOM_ROLES: readonly Role[] = ["SUPER_ADMIN", "EDITOR_IN_CHIEF", "EDITOR", "CAMPUS_EDITOR", "VIEWER"];
