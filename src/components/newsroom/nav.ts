import type { LucideIcon } from "lucide-react";
import { BarChart3, Home, Images, Layers, Newspaper, Palette, Settings, Users } from "lucide-react";
import { roleHasPermission, type Permission, type Role } from "@/lib/auth/permissions";
import type { TranslationKey } from "@/lib/i18n";
import type { Hue } from "@/lib/brand/palette";

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
/**
 * `hue` is not decoration.
 *
 * Each area of Briefly owns one colour from the spectrum, and it owns it everywhere — the sidebar
 * icon, the page it leads to, the chart on that page. After a day nobody reads the label: teal is
 * where the readers are. That only works if the assignment is fixed and written down, which is what
 * this field is; a palette without assignments becomes confetti within a month.
 */
export type NavItem = { href: string; label: TranslationKey; icon: LucideIcon; hue: Hue; permission?: Permission; tabs?: readonly SubTab[]; /** Paths under `href` that belong to another entry. */ exclude?: readonly string[] };

/** Editions in flight, and everything that has already been published. */
export const WORKBENCH_TABS: readonly SubTab[] = [
  { href: "/editions", label: "nav.editions", permission: "edition:view" },
  { href: "/publications", label: "nav.publications", permission: "edition:view" },
  { href: "/studio", label: "nav.studio", permission: "edition:view" },
  { href: "/archive", label: "nav.archive", permission: "archive:view" },
];

/** What the organisation has to say: the stories found, and the people asked for them. */
export const CONTENT_TABS: readonly SubTab[] = [
  { href: "/content", label: "nav.stories", permission: "edition:view", exact: true },
  { href: "/content/contributions", label: "nav.contributions", permission: "submission:view" },
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
 * The client workspace's sidebar: six places to work, two to configure.
 *
 * Home says what is happening; Content is what the organisation has to say; Editions are what is
 * being made of it; Library is its visual memory; Audience is who reads; Analytics is what
 * worked. Brand and Settings sit apart because they are set up once and visited rarely. Running
 * Briefly itself is a different job with its own door (`/admin`) and is not on this list.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/overview", label: "nav.home", icon: Home, hue: "cobalt" },
  { href: "/content", label: "nav.content", icon: Layers, hue: "coral", tabs: CONTENT_TABS },
  { href: "/editions", label: "nav.workbench", icon: Newspaper, hue: "violet", tabs: WORKBENCH_TABS },
  { href: "/library", label: "nav.library", icon: Images, hue: "magenta", permission: "edition:view" },
  { href: "/subscribers", label: "nav.audience", icon: Users, hue: "teal", tabs: AUDIENCE_TABS },
  { href: "/analytics", label: "nav.insights", icon: BarChart3, hue: "green", tabs: INSIGHTS_TABS },
];

export const SETUP_ITEMS: readonly NavItem[] = [
  { href: "/settings/brand", label: "nav.brand", icon: Palette, hue: "magenta", permission: "edition:edit" },
  { href: "/settings", label: "nav.settings", icon: Settings, hue: "amber", permission: "edition:view", exclude: ["/settings/brand"] },
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
  const excluded = item.exclude?.some((href) => pathname === href || pathname.startsWith(`${href}/`)) ?? false;
  const active = !excluded && hrefs.some((href) => pathname === href || pathname.startsWith(`${href}/`));
  return { href: hrefs[0], active };
}

/**
 * An edition's workspace: six doors, each with a few rooms.
 *
 * Overview is where you stand; Stories is the content and the people who sent it; Design is
 * how it looks; Outputs are the shapes it takes; Distribution is who gets it and when;
 * Analytics is what happened. Eleven tabs became six and nothing was removed — every earlier
 * screen is a room behind one of the doors.
 */
export type EditionRoom = { slug: string; label: TranslationKey; permission?: Permission };
export type EditionDoor = { key: string; label: TranslationKey; rooms: readonly EditionRoom[]; permission?: Permission };

export const EDITION_DOORS: readonly EditionDoor[] = [
  { key: "overview", label: "editionTabs.overview", rooms: [{ slug: "", label: "editionTabs.overview" }] },
  {
    key: "stories",
    label: "nav.stories",
    rooms: [
      { slug: "stories", label: "nav.stories" },
      { slug: "articles", label: "nav.articles" },
      { slug: "inbox", label: "nav.contributions", permission: "submission:view" },
      { slug: "campaign", label: "editionTabs.campaign", permission: "campaign:manage" },
    ],
  },
  {
    key: "design",
    label: "editionTabs.design",
    rooms: [
      { slug: "layout", label: "nav.layout" },
      { slug: "media", label: "nav.media" },
    ],
  },
  {
    key: "outputs",
    label: "editionTabs.outputs",
    rooms: [
      { slug: "exports", label: "editionTabs.exports" },
      { slug: "audio", label: "editionTabs.audio" },
    ],
  },
  { key: "distribution", label: "editionTabs.distribution", rooms: [{ slug: "qa", label: "editionTabs.qa" }] },
  { key: "settings", label: "nav.settings", rooms: [{ slug: "settings", label: "nav.settings", permission: "edition:edit" }], permission: "edition:edit" },
];

/** Every room, flat, for the places that still list tabs one by one. */
export const EDITION_TABS: { slug: string; label: TranslationKey; permission?: Permission }[] = EDITION_DOORS.flatMap((door) => door.rooms.map((room) => ({ slug: room.slug, label: room.label, permission: room.permission ?? door.permission })));

/** Which door a path inside an edition is behind. */
export function editionDoorFor(slug: string): EditionDoor | null {
  return EDITION_DOORS.find((door) => door.rooms.some((room) => room.slug === slug)) ?? null;
}
