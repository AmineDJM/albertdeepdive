"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";
import type { CollectionCard, GalleryItem } from "@/server/showcase/service";

/**
 * The gallery, as a visitor sorts it.
 *
 * Filtering happens here rather than on the server because the whole point of the page is to browse:
 * a shelf that reloads is a shelf nobody goes back to. The set is curated and small by nature, so it
 * arrives whole and every control is instant.
 */

const ORDERS = ["curated", "latest", "viewed"] as const;
export type Order = (typeof ORDERS)[number];

export function Facet({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors duration-150",
        active ? "border-foreground/80 bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {label}
      {count !== undefined ? <span className={cn("tabular text-2xs", active ? "text-background/70" : "text-muted-foreground/70")}>{count}</span> : null}
    </button>
  );
}

/** One publication, as a card: the cover does the selling, the words do the explaining. */
export function ItemCard({ item, onOpen, large = false }: { item: GalleryItem; onOpen: (item: GalleryItem) => void; large?: boolean }) {
  const tr = useUi();
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer"
      onClick={() => onOpen(item)}
      className={cn("group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-lg", large && "sm:col-span-2")}
    >
      <span className={cn("relative block overflow-hidden bg-muted", large ? "aspect-[16/9]" : "aspect-[4/3]")}>
        {item.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.coverUrl} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="flex size-full items-center justify-center bg-gradient-to-br from-brand-soft to-muted">
            <span className="masthead px-6 text-center text-[17px] font-semibold tracking-tight text-foreground/70">{item.title}</span>
          </span>
        )}
        {/* The scrim earns its place over a photograph and reads as a smudge over a placeholder. */}
        <span className={cn("absolute inset-x-0 bottom-0 flex items-center gap-1.5 p-3", item.coverUrl && "bg-gradient-to-t from-black/55 to-transparent")}>
          {item.formats.map((format) => (
            <span key={format} className={cn("rounded-[5px] px-1.5 py-px text-2xs font-medium", item.coverUrl ? "bg-white/90 text-black/80" : "border border-border bg-background/80 text-muted-foreground")}>
              {format === "MAGAZINE" ? "PDF" : format.charAt(0) + format.slice(1).toLowerCase()}
            </span>
          ))}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
        <span className="flex items-center gap-2 text-2xs text-muted-foreground">
          <span className="truncate font-medium text-foreground/80">{item.organization}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{item.kind}</span>
        </span>
        <span className={cn("masthead line-clamp-2 font-semibold tracking-tight text-foreground", large ? "text-[21px]" : "text-[17px]")}>{item.title}</span>
        {item.description ? <span className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">{item.description}</span> : null}
        <span className="mt-auto flex items-center gap-1.5 pt-2 text-xs font-medium text-brand opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          {tr("Read it")} <ArrowUpRight className="size-3.5" />
        </span>
      </span>
    </a>
  );
}

export function CollectionTile({ collection, onOpen }: { collection: CollectionCard; onOpen?: () => void }) {
  const tr = useUi();
  return (
    <Link
      href={`/collections/${collection.slug}`}
      onClick={onOpen}
      className="group relative flex min-h-[200px] flex-col justify-end overflow-hidden rounded-2xl border border-border bg-card p-5 transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-lg"
    >
      {collection.coverUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={collection.coverUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
        </>
      ) : (
        <span className="absolute inset-0 bg-gradient-to-br from-brand-soft via-card to-muted" />
      )}
      <span className={cn("relative flex flex-col gap-1", collection.coverUrl ? "text-white" : "text-foreground")}>
        <span className="masthead text-[20px] leading-tight font-semibold tracking-tight">{collection.title}</span>
        {collection.tagline ? <span className={cn("line-clamp-2 text-[13px]", collection.coverUrl ? "text-white/80" : "text-muted-foreground")}>{collection.tagline}</span> : null}
        <span className={cn("mt-1 text-2xs", collection.coverUrl ? "text-white/70" : "text-muted-foreground")}>
          {collection.count === 1 ? tr("1 publication") : tr("{count} publications", { count: collection.count })}
        </span>
      </span>
    </Link>
  );
}

export function GalleryControls({
  query,
  onQuery,
  order,
  onOrder,
  categories,
  category,
  onCategory,
  languages,
  language,
  onLanguage,
  categoryLabel,
  languageLabel,
}: {
  query: string;
  onQuery: (v: string) => void;
  order: Order;
  onOrder: (v: Order) => void;
  categories: { value: string; count: number }[];
  category: string | null;
  onCategory: (v: string | null) => void;
  languages: { value: string; count: number }[];
  language: string | null;
  onLanguage: (v: string | null) => void;
  categoryLabel: (value: string) => string;
  languageLabel: (value: string) => string;
}) {
  const tr = useUi();
  const orderLabels: Record<Order, string> = { curated: tr("Curated picks"), latest: tr("Latest"), viewed: tr("Most viewed") };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex min-w-[240px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">{tr("Search the gallery")}</span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={tr("Search by organization, title or subject…")}
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-4 text-[14px] outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30"
          />
        </label>
        <div className="flex items-center gap-1.5" role="group" aria-label={tr("Order")}>
          {ORDERS.map((value) => (
            <Facet key={value} label={orderLabels[value]} active={order === value} onClick={() => onOrder(value)} />
          ))}
        </div>
      </div>
      {categories.length > 1 || languages.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Facet label={tr("Everything")} active={!category && !language} onClick={() => { onCategory(null); onLanguage(null); }} />
          {categories.map((facet) => (
            <Facet key={facet.value} label={categoryLabel(facet.value)} active={category === facet.value} onClick={() => onCategory(category === facet.value ? null : facet.value)} count={facet.count} />
          ))}
          {languages.length > 1
            ? languages.map((facet) => (
                <Facet key={facet.value} label={languageLabel(facet.value)} active={language === facet.value} onClick={() => onLanguage(language === facet.value ? null : facet.value)} />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

/** The one thing we want a visitor to do, said once and said well. */
export function ShowcaseCta({ onClick, variant = "block" }: { onClick: () => void; variant?: "block" | "inline" }) {
  const tr = useUi();
  if (variant === "inline") {
    return (
      <Button asChild size="lg" onClick={onClick}>
        <Link href="/onboarding">
          <Sparkles /> {tr("Create yours")}
        </Link>
      </Button>
    );
  }
  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-brand-soft/70 via-card to-card p-8 text-center sm:p-12">
      <h2 className="masthead text-[26px] leading-tight font-semibold tracking-tight sm:text-[32px]">{tr("Yours can look like this.")}</h2>
      <p className="mx-auto mt-3 max-w-xl text-[14.5px] leading-6 text-muted-foreground">
        {tr("Every publication here was made by an organization like yours, from what their people sent in. Briefly collected it, wrote it, laid it out and sent it.")}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg" onClick={onClick}>
          <Link href="/onboarding">
            <Sparkles /> {tr("Start with Briefly")}
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/#pricing">{tr("See what it costs")}</Link>
        </Button>
      </div>
    </section>
  );
}

export function useGallery(items: GalleryItem[]) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<Order>("curated");
  const [category, setCategory] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (category && item.category !== category) return false;
      if (language && item.language !== language) return false;
      if (!q) return true;
      return [item.title, item.label, item.organization, item.publication, item.description, item.kind].filter(Boolean).some((field) => field!.toLowerCase().includes(q));
    });
    if (order === "latest") return [...filtered].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
    if (order === "viewed") return [...filtered].sort((a, b) => b.views - a.views);
    return filtered;
  }, [items, query, order, category, language]);
  return { query, setQuery, order, setOrder, category, setCategory, language, setLanguage, shown };
}
