import type { LucideIcon } from "lucide-react";
import { Archive, BarChart3, BookUser, Building2, FileText, Image, Inbox, LayoutTemplate, Library, Mail, Newspaper, Settings, Sparkles, Users, Workflow, Home } from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";
import type { TranslationKey } from "@/lib/i18n";

/**
 * `label` and `groupLabel` are translation keys, not text: the sidebar is a client component that
 * resolves them, so this stays a plain data module usable from the server as well.
 */
export type NavItem = { href: string; label: TranslationKey; icon: LucideIcon; permission?: Permission; editionScoped?: boolean; badgeKey?: "inbox" | "flags" };
export type NavGroup = { label: TranslationKey | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/overview", label: "nav.overview", icon: Home },
      { href: "/publications", label: "nav.publications", icon: Library, permission: "edition:view" },
      { href: "/editions", label: "nav.editions", icon: Newspaper, permission: "edition:view" },
    ],
  },
  {
    label: "nav.currentEdition",
    items: [
      { href: "/inbox", label: "nav.inbox", icon: Inbox, permission: "submission:view", editionScoped: true, badgeKey: "inbox" },
      { href: "/stories", label: "nav.stories", icon: Sparkles, permission: "edition:view", editionScoped: true, badgeKey: "flags" },
      { href: "/articles", label: "nav.articles", icon: FileText, permission: "edition:view", editionScoped: true },
      { href: "/media", label: "nav.media", icon: Image, permission: "edition:view", editionScoped: true },
      { href: "/layout", label: "nav.layout", icon: LayoutTemplate, permission: "edition:view", editionScoped: true },
    ],
  },
  {
    label: "nav.organisation",
    items: [
      { href: "/contributors", label: "nav.contributors", icon: Users, permission: "contributor:manage" },
      { href: "/subscribers", label: "nav.subscribers", icon: Mail, permission: "contributor:manage" },
      { href: "/directory", label: "nav.directory", icon: BookUser, permission: "contributor:manage" },
      { href: "/campuses", label: "nav.campuses", icon: Building2, permission: "edition:view" },
    ],
  },
  {
    label: "nav.system",
    items: [
      { href: "/automations", label: "nav.automations", icon: Workflow, permission: "edition:view" },
      { href: "/analytics", label: "nav.analytics", icon: BarChart3, permission: "analytics:view" },
      { href: "/archive", label: "nav.archive", icon: Archive, permission: "archive:view" },
      { href: "/settings", label: "nav.settings", icon: Settings, permission: "edition:view" },
    ],
  },
];

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
