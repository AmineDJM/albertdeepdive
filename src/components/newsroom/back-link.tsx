"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useUi } from "@/components/i18n/provider";
import { internalReturn } from "@/lib/http/return-to";

/**
 * The way back, top left.
 *
 * A page opened from somewhere with `?return=` goes back there — which is how "Configure" on an
 * edition's table comes back to the table from a page that belongs to the newsletter or to the
 * settings. Otherwise it goes where the page says its parent is.
 */
export function BackLink({ fallback }: { fallback?: { href: string; label: string } }) {
  const tr = useUi();
  const params = useSearchParams();
  const returnTo = internalReturn(params.get("return"));
  const target = returnTo ? { href: returnTo, label: tr("Back") } : fallback;
  if (!target) return null;
  return (
    <Link href={target.href} data-testid="page-back" className="mb-0.5 inline-flex items-center gap-1 rounded-sm text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
      <ArrowLeft className="size-3" /> {target.label}
    </Link>
  );
}
