"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type ShareLink = { label: string; path: string; hint?: string | null };

/**
 * The links a newsroom actually sends people.
 *
 * Shown as the whole address rather than a relative path, because these get pasted into a
 * newsletter footer, a poster and a Slack message — and a link somebody has to reconstruct from
 * "/s/acme-weekly" is a link that gets typed wrong once and shared wrong for a year. The copy
 * button is the point of the component.
 */
export function ShareLinks({ title, description, links }: { title: string; description?: string; links: ShareLink[] }) {
  const tr = useUi();
  const [copied, setCopied] = useState<string | null>(null);
  if (!links.length) return null;

  // The browser knows the address this workspace is being used at, which is the one to share.
  const base = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="label-caps mb-1">{title}</p>
      {description ? <p className="mb-2 text-xs text-muted-foreground">{description}</p> : null}
      <ul className="space-y-1">
        {links.map((link) => {
          const full = `${base}${link.path}`;
          const isCopied = copied === link.path;
          return (
            <li key={link.path} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="w-44 shrink-0 truncate font-medium">{link.label}</span>
              <a href={link.path} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground underline-offset-4 hover:underline">
                {link.path}
              </a>
              {link.hint ? <span className="text-2xs text-muted-foreground">{link.hint}</span> : null}
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(full);
                    setCopied(link.path);
                    setTimeout(() => setCopied((current) => (current === link.path ? null : current)), 2000);
                  } catch {
                    // A browser that refuses the clipboard is not an error worth a dialog: the
                    // address is on the screen and selectable.
                  }
                }}
                className={cn("flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors", isCopied ? "text-success" : "text-brand hover:bg-brand-soft")}
              >
                {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {isCopied ? tr("Copied") : tr("Copy")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
