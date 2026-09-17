"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { Activity, AtSign, BookOpen, Building2, CreditCard, Cpu, LayoutList, Mail, ScrollText, Shield, SlidersHorizontal, UserRound, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { roleHasPermission, type Permission, type Role } from "@/lib/auth/permissions";

export type SettingsNavItem = { href: string; label: string; icon: LucideIcon; permission?: Permission | Permission[]; hint?: string };

export const SETTINGS_NAV: { label: string; items: SettingsNavItem[] }[] = [
  {
    label: "Account",
    items: [{ href: "/settings/profile", label: "Profile", icon: UserRound, hint: "Name, password, theme" }],
  },
  {
    label: "Workspace",
    items: [
      { href: "/settings/workspace", label: "Workspace", icon: Building2, permission: "settings:manage", hint: "Name, brand, language" },
      { href: "/settings/billing", label: "Plan & usage", icon: CreditCard, permission: "settings:manage", hint: "What you get and what you use" },
    ],
  },
  {
    label: "Newsroom",
    items: [
      { href: "/settings/users", label: "Users & roles", icon: Users, permission: "user:manage", hint: "Who can do what" },
      { href: "/settings/sections", label: "Sections", icon: LayoutList, permission: "section:manage", hint: "Default section template" },
      { href: "/settings/prompts", label: "Prompts", icon: Cpu, permission: "prompt:manage", hint: "Versioned AI templates" },
      { href: "/settings/system", label: "System", icon: SlidersHorizontal, permission: "settings:manage", hint: "Masthead, schedule, print, AI" },
      { href: "/settings/privacy", label: "Privacy & retention", icon: Shield, permission: "settings:manage", hint: "GDPR, consent, exports" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/settings/email", label: "Email", icon: AtSign, permission: ["settings:manage"], hint: "Connect the newsroom mailbox" },
      { href: "/settings/mailbox", label: "Mailbox", icon: Mail, permission: ["campaign:manage", "settings:manage"], hint: "Every email the newsroom sent" },
      { href: "/settings/jobs", label: "Jobs & AI trace", icon: Activity, permission: ["ai:run", "settings:manage"], hint: "Queue and model calls" },
      { href: "/settings/audit", label: "Audit log", icon: ScrollText, permission: "audit:view", hint: "Who changed what" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/settings/platform", label: "Workspaces & plans", icon: Building2, permission: "settings:manage", hint: "Every customer on this Briefly" },
    ],
  },
  {
    label: "Help",
    items: [{ href: "/settings/help", label: "How the newsroom works", icon: BookOpen }],
  },
];

export function canSeeSettingsItem(role: Role, item: SettingsNavItem) {
  if (!item.permission) return true;
  const list = Array.isArray(item.permission) ? item.permission : [item.permission];
  return list.some((p) => roleHasPermission(role, p));
}

export function SettingsNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex flex-col gap-3">
      {SETTINGS_NAV.map((group) => {
        const items = group.items.filter((item) => canSeeSettingsItem(role, item));
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
