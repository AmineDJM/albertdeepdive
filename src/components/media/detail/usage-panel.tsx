"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { StoryStatusBadge } from "@/components/newsroom/status-badge";
import { enumLabel } from "@/lib/utils";
import type { MediaDetail, MediaStoryLink, StoryPickerItem } from "@/server/media/library";
import { ROLE_LABELS, STORY_MEDIA_ROLES, type StoryMediaRole } from "@/server/media/constants";
import {
  attachToStoryAction,
  detachFromStoryAction,
  setStoryRoleAction,
} from "@/app/(newsroom)/media/[mediaId]/actions";

const BDD_FIELD_LABELS = {
  logo: "Company logo",
  teamPhoto: "Team photo",
  dashboard: "Dashboard",
  diagram: "Diagram",
} as const;

export function UsagePanel({
  assetId,
  editionId,
  links,
  bddReferences,
  pickerStories,
  canManage,
  blocked,
}: {
  assetId: string;
  editionId: string | null;
  links: MediaStoryLink[];
  bddReferences: MediaDetail["bddReferences"];
  pickerStories: StoryPickerItem[];
  canManage: boolean;
  blocked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<StoryMediaRole>("gallery");
  const [pending, startTransition] = useTransition();
  const linked = new Set(links.map((l) => l.id));
  const available = pickerStories.filter((st) => !linked.has(st.id));

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {links.length ? (
        <ul className="border-border bg-card divide-y rounded-lg border">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/stories/${l.id}`}
                  className="block truncate text-[13px] font-medium hover:underline"
                >
                  {l.title}
                </Link>
                <div className="mt-0.5">
                  <StoryStatusBadge status={l.status} />
                </div>
              </div>
              {canManage ? (
                <NativeSelect
                  aria-label={`Role in ${l.title}`}
                  value={l.role}
                  disabled={pending}
                  onChange={(e) =>
                    run(() =>
                      setStoryRoleAction(
                        assetId,
                        editionId,
                        l.id,
                        e.target.value as StoryMediaRole,
                      ),
                    )
                  }
                  className="h-7 w-auto min-w-28 text-xs"
                >
                  {STORY_MEDIA_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                  {!(STORY_MEDIA_ROLES as readonly string[]).includes(l.role) ? (
                    <option value={l.role}>{enumLabel(l.role)}</option>
                  ) : null}
                </NativeSelect>
              ) : (
                <Badge variant="outline">
                  {ROLE_LABELS[l.role as StoryMediaRole] ?? enumLabel(l.role)}
                </Badge>
              )}
              {canManage ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Detach from ${l.title}`}
                  disabled={pending}
                  onClick={() => run(() => detachFromStoryAction(assetId, editionId, l.id))}
                >
                  <X />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-border text-muted-foreground rounded-lg border border-dashed px-3 py-3 text-center text-xs">
          Not used in any story yet.
        </p>
      )}
      {bddReferences.length ? (
        <ul className="space-y-1">
          {bddReferences.map((b) => (
            <li key={`${b.id}-${b.field}`} className="flex items-center gap-2 text-xs">
              <Building2 className="text-muted-foreground size-3.5" />
              <Link href={`/stories/${b.storyId}`} className="font-medium hover:underline">
                {b.companyName}
                {b.cohortLabel ? ` – ${b.cohortLabel}` : ""}
              </Link>
              <span className="text-muted-foreground">· {BDD_FIELD_LABELS[b.field]}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={blocked || !available.length}
              title={blocked ? "Blocked assets (rights RED) cannot be attached" : undefined}
            >
              <Plus /> Attach to a story
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 p-0">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <span className="label-caps">Role</span>
              <NativeSelect
                aria-label="Role"
                value={role}
                onChange={(e) => setRole(e.target.value as StoryMediaRole)}
                className="h-7 w-auto min-w-28 text-xs"
              >
                {STORY_MEDIA_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Command>
              <CommandInput placeholder="Search the edition's stories…" />
              <CommandList>
                <CommandEmpty>No story matches.</CommandEmpty>
                <CommandGroup heading="Stories">
                  {available.map((st) => (
                    <CommandItem
                      key={st.id}
                      value={`${st.title} ${st.sectionName ?? ""}`}
                      onSelect={() =>
                        run(() => attachToStoryAction(assetId, editionId, st.id, role))
                      }
                      disabled={pending}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{st.title}</div>
                        <div className="text-2xs text-muted-foreground">
                          {st.sectionName ?? "No section"} · {enumLabel(st.status)} ·{" "}
                          {st.mediaCount} media
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
