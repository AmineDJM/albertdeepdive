"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createGroupAction, deleteGroupAction } from "./actions";
import { useUi } from "@/components/i18n/provider";

export function GroupsPanel({ groups, canManage, activeGroupId }: { groups: { id: string; name: string; members: number; isSystem: boolean; description: string | null }[]; canManage: boolean; activeGroupId?: string }) {
  const tr = useUi();
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="rounded-lg border border-border bg-card shadow-xs">
      <div className="border-b px-3 py-2"><span className="label-caps">{tr("Contributor pools")}</span></div>
      <ul className="divide-y">
        {groups.map((g) => (
          <li key={g.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs ${activeGroupId === g.id ? "bg-brand-soft/40" : ""}`}>
            <button type="button" className="flex-1 truncate text-left hover:underline" onClick={() => router.push(activeGroupId === g.id ? "/contributors" : `/contributors?groupId=${g.id}`)} title={g.description ?? undefined}>
              {g.name}
            </button>
            <Badge variant="muted" className="tabular">{g.members}</Badge>
            {canManage && !g.isSystem ? (
              <Button size="icon-xs" variant="ghost" aria-label={tr("Delete group")} onClick={() => startTransition(async () => { const r = await deleteGroupAction(g.id); if (r.ok) toast.success(r.message); else toast.error(r.error); router.refresh(); })}>
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <form className="flex items-center gap-1.5 border-t p-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length < 2) return; startTransition(async () => { const r = await createGroupAction({ name }); if (r.ok) { toast.success(r.message); setName(""); router.refresh(); } else toast.error(r.error); }); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("New pool (e.g. B2 representatives)")} className="h-7 text-xs" />
          <Button size="icon-sm" type="submit" variant="outline" loading={pending} aria-label={tr("Add group")}><Plus /></Button>
        </form>
      ) : null}
    </div>
  );
}
