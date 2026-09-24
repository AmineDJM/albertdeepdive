"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { attachContributorsAction, detachContributorAction } from "@/app/(newsroom)/contributors/actions";
import { useUi } from "@/components/i18n/provider";

/** Put people the workspace already knows on this newsletter's list. */
export function AddExistingContributors({ publicationId, people }: { publicationId: string; people: { id: string; name: string; email: string }[] }) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? people.filter((person) => `${person.name} ${person.email}`.toLowerCase().includes(q)) : people;
  }, [people, query]);
  if (!people.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus /> {tr("Add from your people")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("Add from your people")}</DialogTitle>
          <DialogDescription>{tr("People your organisation already knows, who do not write for this newsletter yet.")}</DialogDescription>
        </DialogHeader>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr("Search a name or an email")} aria-label={tr("Search a name or an email")} />
        <ul className="max-h-72 space-y-0.5 overflow-y-auto scrollbar-thin">
          {shown.map((person) => (
            <li key={person.id}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
                <Checkbox
                  checked={chosen.has(person.id)}
                  onCheckedChange={(on) => setChosen((current) => { const next = new Set(current); if (on) next.add(person.id); else next.delete(person.id); return next; })}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{person.name}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{person.email}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
          <Button
            loading={pending}
            disabled={!chosen.size}
            onClick={() =>
              start(async () => {
                const res = await attachContributorsAction(publicationId, [...chosen]);
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(res.message);
                setChosen(new Set());
                setOpen(false);
                router.refresh();
              })
            }
          >
            {chosen.size === 1 ? tr("Add 1 person") : tr("Add {count} people", { count: chosen.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Off this newsletter's list; still one of the organisation's people. */
export function DetachContributor({ publicationId, contributorId, name }: { publicationId: string; contributorId: string; name: string }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={tr("Take {name} off this newsletter", { name })}
      title={tr("Take off this newsletter")}
      disabled={pending}
      data-no-row-link
      onClick={() =>
        start(async () => {
          const res = await detachContributorAction(publicationId, contributorId);
          if (!res.ok) toast.error(res.error);
          else {
            toast.success(res.message);
            router.refresh();
          }
        })
      }
    >
      <X />
    </Button>
  );
}
