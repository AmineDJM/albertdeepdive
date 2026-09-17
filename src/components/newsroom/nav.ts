import type { LucideIcon } from "lucide-react";
import { Archive, BarChart3, BookUser, Building2, FileText, Image, Inbox, LayoutTemplate, Library, Mail, Newspaper, Settings, Sparkles, Users, Workflow, Home } from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";

export type NavItem = { href: string; label: string; icon: LucideIcon; permission?: Permission; editionScoped?: boolean; badgeKey?: "inbox" | "flags" };
export type NavGroup = { label: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/overview", label: "Overview", icon: Home },
      { href: "/publications", label: "Publications", icon: Library, permission: "edition:view" },
      { href: "/editions", label: "Editions", icon: Newspaper, permission: "edition:view" },
    ],
  },
  {
    label: "Current edition",
    items: [
      { href: "/inbox", label: "Inbox", icon: Inbox, permission: "submission:view", editionScoped: true, badgeKey: "inbox" },
      { href: "/stories", label: "Stories", icon: Sparkles, permission: "edition:view", editionScoped: true, badgeKey: "flags" },
      { href: "/articles", label: "Articles", icon: FileText, permission: "edition:view", editionScoped: true },
      { href: "/media", label: "Media", icon: Image, permission: "edition:view", editionScoped: true },
      { href: "/layout", label: "Layout", icon: LayoutTemplate, permission: "edition:view", editionScoped: true },
    ],
  },
  {
    label: "Organisation",
    items: [
      { href: "/contributors", label: "Contributors", icon: Users, permission: "contributor:manage" },
      { href: "/subscribers", label: "Subscribers", icon: Mail, permission: "contributor:manage" },
      { href: "/directory", label: "Directory", icon: BookUser, permission: "contributor:manage" },
      { href: "/campuses", label: "Campuses", icon: Building2, permission: "edition:view" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/automations", label: "Automations", icon: Workflow, permission: "edition:view" },
      { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics:view" },
      { href: "/archive", label: "Archive", icon: Archive, permission: "archive:view" },
      { href: "/settings", label: "Settings", icon: Settings, permission: "edition:view" },
    ],
  },
];

export const EDITION_TABS: { slug: string; label: string; permission?: Permission }[] = [
  { slug: "", label: "Control room" },
  { slug: "campaign", label: "Campaign", permission: "campaign:manage" },
  { slug: "inbox", label: "Inbox", permission: "submission:view" },
  { slug: "stories", label: "Stories" },
  { slug: "articles", label: "Articles" },
  { slug: "media", label: "Media" },
  { slug: "layout", label: "Layout" },
  { slug: "qa", label: "QA & publish" },
  { slug: "exports", label: "Exports" },
  { slug: "settings", label: "Settings", permission: "edition:edit" },
];
