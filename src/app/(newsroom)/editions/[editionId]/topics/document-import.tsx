"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/i18n/provider";
import { importTopicsDocumentAction } from "./actions";

const ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.markdown,.html,.htm";

/**
 * Hand Briefly a document and get topics back.
 *
 * The file is read on the server and its parts filed as the editor's own contributions; the topics
 * appear here as soon as the pipeline has grouped them, which this screen watches for while it
 * works rather than asking anybody to reload.
 */
export function DocumentImport({ editionId, reading }: { editionId: string; reading: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [reading, router]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3" data-testid="topics-document">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{tr("Already have it written down?")}</p>
        <p className="text-xs text-muted-foreground">{tr("Drop a report, a deck or your notes (PDF, Word, PowerPoint, text). Briefly reads it and turns it into topics.")}</p>
      </div>
      {reading ? (
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 animate-spin" /> {tr("Turning your document into topics…")}
        </span>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label={tr("Document to turn into topics")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const form = new FormData();
          form.set("file", file);
          start(async () => {
            const res = await importTopicsDocumentAction(editionId, form);
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success(res.message);
            router.refresh();
          });
        }}
      />
      <Button variant="outline" loading={pending} onClick={() => input.current?.click()}>
        <FileUp /> {tr("Import a document")}
      </Button>
    </div>
  );
}
