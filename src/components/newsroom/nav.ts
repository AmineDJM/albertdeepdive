import type { LucideIcon } from "lucide-react";
import { BarChart3, Home, Library, Newspaper, Settings, Shield, Users } from "lucide-react";
import { roleHasPermission, type Permission, type Role } from "@/lib/auth/permissions";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The navigation, in two levels and no more.
 *
 * The sidebar answers "which part of the workspace", a tab bar answers "which view of it". Nothing
 * appears in both. The earlier sidebar carried sixteen destinations, five of which were a second
 * copy of the tab bar an edition already has — two ways to reach the same screen is not twice the
 * convenience, it is a question the reader has to answer before every click.
 *
 * Every route that left the sidebar is still here, as a tab or under Settings, and every one of them
 * is in the ⌘K menu. This reorganises; it removes nothing.
 *
 * `label` values are translation keys, not text: the sidebar resolves them on the client, so this
 * stays a plain data module the server can import too.
 */
export type SubTab = { href: string; label: TranslationKey; permission?: Permission; exact?: boolean };
export type NavItem = { href: string; label: TranslationKey; icon: LucideIcon; permission?: Permission; tabs?: readonly SubTab[] };

/** Editions in flight, and everything that has already been published. */
export const WORKBENCH_TABS: readonly SubTab[] = [
  { href: "/editions", label: "nav.editions", permission: "edition:view" },
  { href: "/archive", label: "nav.archive", permission: "archive:view" },
];

/** Everyone the workspace writes to, writes with, or organises by. */
export const AUDIENCE_TABS: readonly SubTab[] = [
  { href: "/subscribers", label: "nav.subscribers", permission: "contributor:manage" },
  { href: "/directory", label: "nav.directory", permission: "contributor:manage" },
  { href: "/contributors", label: "nav.contributors", permission: "contributor:manage" },
  { href: "/campuses", label: "nav.campuses", permission: "edition:view" },
];

/** What happened, and what runs on its own. */
export const INSIGHTS_TABS: readonly SubTab[] = [
  { href: "/analytics", label: "nav.analytics", permission: "analytics:view" },
  { href: "/automations", label: "nav.automations", permission: "edition:view" },
];

/**
 * Running Briefly itself, which is not the same job as running a workspace.
 *
 * `settings:manage` is the platform role — workspace owners are OWNER on their membership, not
 * SUPER_ADMIN on their user — so this entry is invisible to customers. It used to sit at the bottom
 * of workspace settings, one heading away from "Sections", which made "every customer on this
 * Briefly" look like a preference. It is a different job, so it gets its own door.
 */
export const PLATFORM_TABS: readonly SubTab[] = [
  { href: "/platform", label: "nav.customers", permission: "settings:manage", exact: true },
  { href: "/platform/integrations", label: "nav.integrations", permission: "settings:manage" },
];

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/overview", label: "nav.overview", icon: Home },
  { href: "/publications", label: "nav.publications", icon: Library, permission: "edition:view" },
  { href: "/editions", label: "nav.workbench", icon: Newspaper, tabs: WORKBENCH_TABS },
  { href: "/subscribers", label: "nav.audience", icon: Users, tabs: AUDIENCE_TABS },
  { href: "/analytics", label: "nav.insights", icon: BarChart3, tabs: INSIGHTS_TABS },
  { href: "/settings", label: "nav.settings", icon: Settings, permission: "edition:view" },
  { href: "/platform", label: "nav.platform", icon: Shield, permission: "settings:manage", tabs: PLATFORM_TABS },
];

export function visibleTabs(role: Role, tabs: readonly SubTab[]): SubTab[] {
  return tabs.filter((tab) => !tab.permission || roleHasPermission(role, tab.permission));
}

/**
 * Where a sidebar entry points, and whether it is showing.
 *
 * A grouped entry links to the first tab its reader is allowed to open rather than to a fixed one —
 * a campus editor may not see subscribers, so Audience takes them to campuses instead of to a
 * refusal — and it lights up for any of its tabs.
 */
export function resolveNavItem(role: Role, item: NavItem, pathname: string): { href: string; active: boolean } | null {
  const tabs = item.tabs ? visibleTabs(role, item.tabs) : [];
  if (item.tabs && !tabs.length) return null;
  if (item.permission && !roleHasPermission(role, item.permission)) return null;
  const hrefs = tabs.length ? tabs.map((t) => t.href) : [item.href];
  const active = hrefs.some((href) => pathname === href || pathname.startsWith(`${href}/`));
  return { href: hrefs[0], active };
}

export const EDITION_TABS: { slug: string; label: TranslationKey; permission?: Permission }[] = [
  { slug: "", label: "editionTabs.controlRoom" },
  { slug: "campaign", label: "editionTabs.campaign", permission: "campaign:manage" },
  { slug: "inbox", label: "nav.inbox", permission: "submission:view" },
  { slug: "stories", label: "nav.stories" },
  { slug: "articles", label: "nav.articles" },
  { slug: "media", label: "nav.media" },
  { slug: "layout", label: "nav.layout" },
  { slug: "qa", label: "editionTabs.qa" },
  { slug: "exports", label: "editionTabs.exports" },
  { slug: "settings", label: "nav.settings", permission: "edition:edit" },
];
