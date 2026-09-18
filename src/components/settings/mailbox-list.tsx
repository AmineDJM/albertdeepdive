"use client";

import { useState } from "react";
import { ExternalLink, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { enumLabel } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type MailMessage = {
  id: string;
  to: string;
  subject: string;
  html: string;
  template: string | null;
  status: string;
  provider: string | null;
  error: string | null;
  editionLabel: string | null;
  createdAt: string;
  sentAt: string | null;
};

const TONE: Record<string, "success" | "warning" | "destructive" | "muted"> = {
  SENT: "success",
  LOGGED: "muted",
  QUEUED: "warning",
  FAILED: "destructive",
};

/** Extracts the contribution link so a link can be opened straight from the message. */
function contributionLink(html: string): string | null {
  return /href="([^"]*\/(?:contribute|respond)\/[^"]+)"/.exec(html)?.[1] ?? null;
}

export function MailboxList({ messages }: { messages: MailMessage[] }) {
  const tr = useUi();
  const [open, setOpen] = useState<MailMessage | null>(null);
  const link = open ? contributionLink(open.html) : null;

  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {messages.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => setOpen(m)} className="flex w-full items-start gap-3 bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-accent/30">
              <Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-xs font-medium">{m.subject}</span>
                  <Badge variant={TONE[m.status] ?? "muted"} className="text-2xs">
                    {m.status.toLowerCase()}
                  </Badge>
                  {m.template ? <Badge variant="outline" className="text-2xs">{tr(enumLabel(m.template))}</Badge> : null}
                </div>
                <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                  {tr("To")}{" "}{m.to}
                  {m.editionLabel ? ` · ${m.editionLabel}` : ""}
                  {m.error ? ` · ${m.error}` : ""}
                </p>
              </div>
              <span className="tabular shrink-0 text-2xs text-muted-foreground">{new Date(m.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{open?.subject}</DialogTitle>
            <DialogDescription>
              {tr("To")}{" "}{open?.to} · {open?.template ? enumLabel(open.template) : "no template"} {" "}{tr("· sent through “")}{open?.provider ?? "unknown"}”
            </DialogDescription>
          </DialogHeader>
          {link ? (
            <Button size="sm" variant="outline" asChild className="self-start">
              <a href={link} target="_blank" rel="noreferrer">
                {tr("Open the personal link")}{" "}<ExternalLink />
              </a>
            </Button>
          ) : null}
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border bg-white p-4 text-sm text-neutral-900">
            {/* The body is rendered by our own templates; it never contains third-party markup. */}
            <div dangerouslySetInnerHTML={{ __html: open?.html ?? "" }} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
