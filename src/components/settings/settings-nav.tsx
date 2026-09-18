"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Activity, AtSign, BookOpen, Building2, CreditCard, Cpu, LayoutList, Mail, Palette, ScrollText, Shield, SlidersHorizontal, UserRound, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleHasPermission, type Permission, type Role } from "@/lib/auth/permissions";
import { useUi } from "@/components/i18n/provider";

export type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "CONTRIBUTOR" | "VIEWER";
/**
 * An item is shown for a platform permission, or for a role in the workspace, or either. The
 * workspace's own configuration — its name, brand, plan, payment account — is the owner's to see
 * whatever they are in Briefly; the platform-wide settings stay behind the platform permission.
 */
export type SettingsNavItem = { href: string; label: string; icon: LucideIcon; permission?: Permission | Permission[]; workspaceRoles?: WorkspaceRole[]; hint?: string };

/**
 * Settings, in three groups instead of six.
 *
 * What went: Profile and Help, which are one click away in the top bar from every screen and did not
 * need a third door; and the platform console, which was never workspace settings at all — it reads
 * across every customer on this Briefly and now lives in its own area. What stayed is what an
 * administrator actually configures, and it is grouped by who is asking rather than by subsystem.
 *
 * Two of the names changed. "Email" and "Mailbox" sat next to each other meaning, respectively, the
 * address the newsroom sends from and the log of what it sent — a distinction the labels did nothing
 * to carry. And "System" was a heading, not a description.
 */
export const SETTINGS_NAV: { label: string; items: SettingsNavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/settings/profile", label: "Your profile", icon: UserRound, hint: "Name, password, theme" },
      { href: "/settings/workspace", label: "Workspace", icon: Building2, permission: "settings:manage", workspaceRoles: ["OWNER", "ADMIN"], hint: "Name, address, language" },
      { href: "/settings/brand", label: "Brand", icon: Palette, permission: "settings:manage", workspaceRoles: ["OWNER", "ADMIN"], hint: "Colours, type and voice" },
      { href: "/settings/billing", label: "Plan & usage", icon: CreditCard, permission: "settings:manage", workspaceRoles: ["OWNER", "ADMIN"], hint: "What you get and what you use" },
      { href: "/settings/payments", label: "Reader payments", icon: Wallet, permission: "settings:manage", workspaceRoles: ["OWNER", "ADMIN"], hint: "Charge for a title on your Stripe" },
      { href: "/settings/users", label: "Users & roles", icon: Users, permission: "user:manage", hint: "Who can do what" },
    ],
  },
  {
    label: "Newsroom",
    items: [
      { href: "/settings/system", label: "Publishing defaults", icon: SlidersHorizontal, permission: "settings:manage", hint: "Masthead, schedule, print, AI" },
      { href: "/settings/sections", label: "Sections", icon: LayoutList, permission: "section:manage", hint: "Default section template" },
      { href: "/settings/prompts", label: "Prompts", icon: Cpu, permission: "prompt:manage", hint: "Versioned AI templates" },
      { href: "/settings/email", label: "Sending address", icon: AtSign, permission: ["settings:manage"], hint: "Connect the newsroom mailbox" },
      { href: "/settings/privacy", label: "Privacy & retention", icon: Shield, permission: "settings:manage", hint: "GDPR, consent, exports" },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/settings/mailbox", label: "Sent mail", icon: Mail, permission: ["campaign:manage", "settings:manage"], hint: "Every email the newsroom sent" },
      { href: "/settings/jobs", label: "Jobs & AI trace", icon: Activity, permission: ["ai:run", "settings:manage"], hint: "Queue and model calls" },
      { href: "/settings/audit", label: "Audit log", icon: ScrollText, permission: "audit:view", hint: "Who changed what" },
      { href: "/settings/help", label: "How Briefly works", icon: BookOpen },
    ],
  },
];

export function canSeeSettingsItem(role: Role, item: SettingsNavItem, workspaceRole?: WorkspaceRole | null) {
  if (item.workspaceRoles && workspaceRole && item.workspaceRoles.includes(workspaceRole)) return true;
  if (!item.permission) return true;
  const list = Array.isArray(item.permission) ? item.permission : [item.permission];
  return list.some((p) => roleHasPermission(role, p));
}

export function SettingsNav({ role, workspaceRole = null }: { role: Role; workspaceRole?: WorkspaceRole | null }) {
  const tr = useUi();
  const pathname = usePathname();
  return (
    <nav aria-label={tr("Settings")} className="flex flex-col gap-3">
      {SETTINGS_NAV.map((group) => {
        const items = group.items.filter((item) => canSeeSettingsItem(role, item, workspaceRole));
        if (!items.length) return null;
        return (
          <div key={group.label}>
            <div className="label-caps px-2 pb-1">{group.label}</div>
            <ul className="space-y-px">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
                        active ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                      )}
                    >
                      <item.icon className={cn("size-3.5 shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-foreground")} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
