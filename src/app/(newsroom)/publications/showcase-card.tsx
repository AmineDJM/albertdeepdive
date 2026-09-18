"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SettingsCard } from "@/components/settings/key-value";
import { Badge } from "@/components/ui/badge";
import { setShowcaseConsentAction } from "./actions";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type ShowcaseRow = {
  publicationId: string;
  name: string;
  consent: string;
  showable: number;
  collections: { slug: string; title: string }[];
};

/**
 * Whether the world may see this title, decided by the people who own it.
 *
 * Off for everything until somebody here turns it on, and off again the moment they change their
 * mind. The card says exactly what would become visible — published editions with a public web
 * page, and no others — because a consent screen that is vague about what it covers is not consent.
 */
export function ShowcaseCard({ rows, canManage }: { rows: ShowcaseRow[]; canManage: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState(rows);

  function toggle(row: ShowcaseRow) {
    const on = row.consent === "NONE";
    setState((rs) => rs.map((r) => (r.publicationId === row.publicationId ? { ...r, consent: on ? "CUSTOMER" : "NONE" } : r)));
    start(async () => {
      const res = await setShowcaseConsentAction(row.publicationId, on);
      if (!res.ok) {
        setState(rows);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? tr("Saved"));
      router.refresh();
    });
  }

  if (!state.length) return null;

  return (
    <SettingsCard
      title={tr("Briefly's public gallery")}
      description={tr("Briefly keeps a gallery of real publications at briefly.press/collections. Nothing of yours is in it unless you say so here, and only editions you have already published on the web.")}
      action={
        <Link href="/collections" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {tr("See the gallery")} <ExternalLink className="size-3" />
        </Link>
      }
    >
      <ul className="divide-y divide-border">
        {state.map((row) => {
          const on = row.consent !== "NONE";
          return (
            <li key={row.publicationId} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium">{row.name}</span>
                  {on ? <Badge variant="success">{tr("Shown")}</Badge> : <Badge variant="muted">{tr("Private")}</Badge>}
                  {row.consent === "PERMISSION" ? <Badge variant="outline">{tr("permission recorded")}</Badge> : null}
                </span>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {on
                    ? row.showable === 0
                      ? tr("Nothing to show yet: publish an edition on the web and it appears.")
                      : row.showable === 1
                        ? tr("1 edition could be shown")
                        : tr("{count} editions could be shown", { count: row.showable })
                    : tr("Not visible to anyone outside your workspace.")}
                  {on && row.collections.length ? ` · ${row.collections.map((c) => c.title).join(", ")}` : ""}
                </p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={tr("Show {name} in the gallery", { name: row.name })}
                  onClick={() => toggle(row)}
                  disabled={pending}
                  className={cn("flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-60", on ? "bg-brand" : "bg-muted")}
                >
                  <span className={cn("size-4 rounded-full bg-white transition-transform", on && "translate-x-4")} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex items-start gap-1.5 text-2xs text-muted-foreground">
        <Sparkles className="mt-0.5 size-3 shrink-0" />
        {tr("Being in the gallery sends readers to your own public page. Turn it off and your editions disappear from it at once.")}
      </p>
    </SettingsCard>
  );
}
