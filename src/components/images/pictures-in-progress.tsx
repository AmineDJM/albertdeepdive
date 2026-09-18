"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useLocale, useUi } from "@/components/i18n/provider";
import { cn, relativeTime } from "@/lib/utils";
import type { ImageVersionView } from "@/server/images/views";

const STATUS_WORDS: Record<ImageVersionView["status"], { en: string; fr: string }> = {
  QUEUED: { en: "Queued", fr: "En attente" },
  RUNNING: { en: "Being made", fr: "En cours" },
  READY: { en: "Ready", fr: "Prête" },
  FAILED: { en: "Did not come out", fr: "Échec" },
  REJECTED: { en: "Thrown out", fr: "Écartée" },
};

/** Pictures asked for here: the ones being made, the ones that did not come out, the ones just made. */
export function PicturesInProgress({ versions }: { versions: ImageVersionView[] }) {
  const tr = useUi();
  const locale = useLocale();
  const router = useRouter();
  const busy = versions.some((version) => version.status === "QUEUED" || version.status === "RUNNING");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [busy, router]);
  if (!versions.length) return null;
  return (
    <section data-testid="pictures-in-progress">
      <h2 className="label-caps mb-2">{tr("Generated pictures")}</h2>
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {versions.map((version) => {
          const inner = (
            <>
              <div className={cn("aspect-[3/2] w-40 overflow-hidden rounded-md bg-muted", (version.status === "QUEUED" || version.status === "RUNNING") && "animate-pulse bg-brand-soft")}>
                {version.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={version.thumbUrl} alt={version.label} className="size-full object-cover" />
                ) : null}
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs">
                <Badge variant={version.status === "READY" ? "success" : version.status === "FAILED" ? "destructive" : "info"}>{STATUS_WORDS[version.status][locale]}</Badge>
                <span className="text-muted-foreground">{relativeTime(new Date(version.createdAt))}</span>
              </p>
              <p className="w-40 truncate text-2xs text-muted-foreground" title={version.instruction}>
                {version.instruction}
              </p>
              {version.error ? <p className="w-40 text-2xs text-destructive">{version.error}</p> : null}
            </>
          );
          return (
            <li key={version.id} className="shrink-0">
              {version.mediaId ? (
                <Link href={`/media/${version.mediaId}`} className="block">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
