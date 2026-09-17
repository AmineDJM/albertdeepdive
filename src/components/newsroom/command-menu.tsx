"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, BarChart3, BookUser, Building2, FileText, Image, Inbox, LayoutTemplate, Library, Mail, Newspaper, Plug, Plus, Send, Settings, Shield, Sparkles, Users, Workflow, Home, Loader2 } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { searchAction } from "@/app/(newsroom)/actions";
import { roleHasPermission, type Permission, type Role } from "@/lib/auth/permissions";
import type { SearchHit } from "@/server/search/service";

type QuickLink = { label: string; href: string; icon: React.ComponentType<{ className?: string }>; need?: Permission };

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { edition: Newspaper, story: Sparkles, article: FileText, submission: Inbox, media: Image, contributor: Users, person: Users, organisation: Building2, event: Archive, bdd: Sparkles };

export function CommandMenu({ open, onOpenChange, currentEditionId, role }: { open: boolean; onOpenChange: (open: boolean) => void; currentEditionId: string | null; role: Role }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<{ group: string; hits: SearchHit[] }[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const tooShort = query.trim().length < 2;
  // Results are hidden (not cleared from state) while the query is too short, so no state is
  // written synchronously from the effect.
  const visibleGroups = tooShort ? [] : groups;

  useEffect(() => {
    if (!open || tooShort) return;
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await searchAction(query);
        setGroups(res.ok ? res.data : []);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [query, open, tooShort]);

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  const ed = currentEditionId ? `/editions/${currentEditionId}` : null;
  // The sidebar deliberately lists six destinations; this lists all of them. Anything that left the
  // sidebar has to stay one keystroke away, or the simplification is just a removal.
  const quick: QuickLink[] = [
    { label: "Overview", href: "/overview", icon: Home },
    { label: "Publications", href: "/publications", icon: Library },
    { label: "Editions", href: "/editions", icon: Newspaper },
    ...(ed
      ? [
          { label: "Control room", href: ed, icon: LayoutTemplate },
          { label: "Inbox", href: `${ed}/inbox`, icon: Inbox },
          { label: "Stories", href: `${ed}/stories`, icon: Sparkles },
          { label: "Articles", href: `${ed}/articles`, icon: FileText },
          { label: "Media", href: `${ed}/media`, icon: Image },
          { label: "Layout", href: `${ed}/layout`, icon: LayoutTemplate },
          { label: "QA & publish", href: `${ed}/qa`, icon: Workflow },
          { label: "Exports", href: `${ed}/exports`, icon: FileText },
          { label: "Campaign", href: `${ed}/campaign`, icon: Send },
        ]
      : []),
    { label: "Subscribers", href: "/subscribers", icon: Mail, need: "contributor:manage" as Permission },
    { label: "Directory", href: "/directory", icon: BookUser, need: "contributor:manage" as Permission },
    { label: "Contributors", href: "/contributors", icon: Users, need: "contributor:manage" as Permission },
    { label: "Campuses", href: "/campuses", icon: Building2 },
    { label: "Analytics", href: "/analytics", icon: BarChart3, need: "analytics:view" as Permission },
    { label: "Automations", href: "/automations", icon: Workflow },
    { label: "Archive", href: "/archive", icon: Archive, need: "archive:view" as Permission },
    { label: "Media library", href: "/media", icon: Image },
    { label: "Settings", href: "/settings", icon: Settings },
    { label: "Plan & usage", href: "/settings/billing", icon: Settings, need: "settings:manage" as Permission },
    { label: "Users & roles", href: "/settings/users", icon: Users, need: "user:manage" as Permission },
    { label: "Platform: customers & plans", href: "/platform", icon: Shield, need: "settings:manage" as Permission },
    { label: "Platform: integrations", href: "/platform/integrations", icon: Plug, need: "settings:manage" as Permission },
  ].filter((q) => !q.need || roleHasPermission(role, q.need));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search editions, submissions, stories, articles, people, organisations, media and events">
      <CommandInput placeholder="Search everything or type a command…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{pending ? <span className="inline-flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Searching…</span> : tooShort ? "Type at least two characters." : "No results."}</CommandEmpty>
        {visibleGroups.map((g) => (
          <CommandGroup key={g.group} heading={g.group}>
            {g.hits.map((hit) => {
              const Icon = ICONS[hit.type] ?? Sparkles;
              return (
                <CommandItem key={`${hit.type}-${hit.id}`} value={`${g.group} ${hit.title} ${hit.subtitle ?? ""} ${hit.id}`} onSelect={() => go(hit.href)}>
                  <Icon />
                  <span className="truncate">{hit.title}</span>
                  {hit.subtitle ? <span className="ml-auto truncate text-2xs text-muted-foreground">{hit.subtitle}</span> : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
        {visibleGroups.length ? <CommandSeparator /> : null}
        <CommandGroup heading="Go to">
          {quick.map((q) => (
            <CommandItem key={q.href} value={`goto ${q.label}`} onSelect={() => go(q.href)}>
              <q.icon />
              {q.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="new edition" onSelect={() => go("/editions?new=1")}>
            <Plus /> New edition
          </CommandItem>
          <CommandItem value="new contributor" onSelect={() => go("/contributors?new=1")}>
            <Plus /> New contributor
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
