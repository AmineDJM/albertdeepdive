"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowDown, ArrowUp, ExternalLink, Plus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SettingsCard } from "@/components/settings/key-value";
import { addToCollectionAction, deleteCollectionAction, removeFromCollectionAction, reorderCollectionAction, setItemAction, setPlatformConsentAction, updateCollectionAction } from "../actions";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

type Collection = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  language: string | null;
  tags: string[];
  coverUrl: string | null;
  isPublished: boolean;
  isFeatured: boolean;
  pinnedOrder: number | null;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
};

type Item = {
  editionId: string;
  label: string;
  title: string;
  organization: string;
  publication: string | null;
  blurb: string | null;
  isFeatured: boolean;
  showing: boolean;
  why: string | null;
  coverUrl: string | null;
  href: string | null;
};

type Candidate = { editionId: string; label: string; title: string; organization: string; coverUrl: string | null };
type Publication = { id: string; name: string; organization: string; consent: string; note: string | null; isDemo: boolean };

export function CollectionEditor({ collection, items, candidates, publications }: { collection: Collection; items: Item[]; candidates: Candidate[]; publications: Publication[] }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(collection);
  const [order, setOrder] = useState(items);
  const [query, setQuery] = useState("");

  const set = <K extends keyof Collection>(key: K, value: Collection[K]) => setForm((f) => ({ ...f, [key]: value }));

  function save() {
    start(async () => {
      const res = await updateCollectionAction(collection.id, {
        title: form.title,
        tagline: form.tagline,
        description: form.description,
        category: form.category,
        language: form.language,
        tags: form.tags,
        coverUrl: form.coverUrl ?? "",
        isPublished: form.isPublished,
        isFeatured: form.isFeatured,
        pinnedOrder: form.pinnedOrder,
        sortOrder: form.sortOrder,
        seoTitle: form.seoTitle,
        seoDescription: form.seoDescription,
      });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? tr("Saved"));
        router.refresh();
      }
    });
  }

  function move(index: number, by: -1 | 1) {
    const next = [...order];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    start(async () => {
      const res = await reorderCollectionAction(collection.id, next.map((item) => item.editionId));
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  function add(editionId: string) {
    start(async () => {
      const res = await addToCollectionAction(collection.id, [editionId]);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? tr("Added"));
        router.refresh();
      }
    });
  }

  function remove(editionId: string) {
    start(async () => {
      const res = await removeFromCollectionAction(collection.id, [editionId]);
      if (!res.ok) toast.error(res.error);
      else {
        setOrder((o) => o.filter((item) => item.editionId !== editionId));
        router.refresh();
      }
    });
  }

  function feature(item: Item) {
    start(async () => {
      const res = await setItemAction(collection.id, item.editionId, { isFeatured: !item.isFeatured });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  function blurb(item: Item, value: string) {
    start(async () => {
      const res = await setItemAction(collection.id, item.editionId, { blurb: value });
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  }

  const shown = candidates.filter((candidate) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [candidate.label, candidate.title, candidate.organization].some((field) => field.toLowerCase().includes(q));
  });
  const hidden = order.filter((item) => !item.showing).length;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <SettingsCard
          title={tr("What it is")}
          description={tr("The name, the line under it, and where it sits in the gallery.")}
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={`/collections/${collection.slug}`} target="_blank" rel="noreferrer">
                  {tr("Preview")} <ExternalLink />
                </a>
              </Button>
              <Button size="sm" onClick={save} loading={pending}>{tr("Save")}</Button>
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">{tr("Name")}</Label>
              <Input id="title" value={form.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">{tr("Category")}</Label>
              <Input id="category" value={form.category ?? ""} onChange={(e) => set("category", e.target.value || null)} placeholder={tr("universities")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tagline">{tr("One line under it")}</Label>
              <Input id="tagline" value={form.tagline ?? ""} onChange={(e) => set("tagline", e.target.value || null)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">{tr("Description")}</Label>
              <Textarea id="description" rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value || null)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cover">{tr("Cover image")}</Label>
              <Input id="cover" value={form.coverUrl ?? ""} onChange={(e) => set("coverUrl", e.target.value || null)} placeholder="https://…" />
              <p className="text-2xs text-muted-foreground">{tr("Leave empty and the featured publication’s cover is used.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tags">{tr("Tags")}</Label>
              <Input id="tags" value={form.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} placeholder={tr("education, campus, alumni")} />
            </div>
          </div>
        </SettingsCard>

        <SettingsCard title={tr("In this collection")} description={hidden ? tr("{count} of these are not being shown. Each says why.", { count: hidden }) : tr("The order here is the order on the page.")}>
          {order.length ? (
            <ul className="divide-y divide-border">
              {order.map((item, index) => (
                <li key={item.editionId} className={cn("flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0", !item.showing && "opacity-70")}>
                  <span className="flex shrink-0 flex-col gap-0.5">
                    <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || pending} aria-label={tr("Move up")} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => move(index, 1)} disabled={index === order.length - 1 || pending} aria-label={tr("Move down")} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ArrowDown className="size-3.5" />
                    </button>
                  </span>
                  {item.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.coverUrl} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="h-12 w-9 shrink-0 rounded bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{item.label}</span>
                      <span className="text-xs text-muted-foreground">{item.organization}</span>
                      {item.isFeatured ? <Badge variant="outline">{tr("Featured")}</Badge> : null}
                      {!item.showing ? <Badge variant="warning">{tr("Not showing")}</Badge> : null}
                    </span>
                    {item.why ? (
                      <p className="mt-0.5 flex items-center gap-1 text-2xs text-warning">
                        <AlertCircle className="size-3" /> {item.why}
                      </p>
                    ) : null}
                    <Input
                      defaultValue={item.blurb ?? ""}
                      onBlur={(e) => e.target.value !== (item.blurb ?? "") && blurb(item, e.target.value)}
                      placeholder={tr("A line about this one, here")}
                      className="mt-1.5 h-8 text-xs"
                    />
                  </div>
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => feature(item)} disabled={pending} aria-label={tr("Feature")} className={cn("rounded p-1", item.isFeatured ? "text-warning" : "text-muted-foreground hover:text-foreground")}>
                      <Star className={cn("size-4", item.isFeatured && "fill-current")} />
                    </button>
                    {item.href ? (
                      <a href={item.href} target="_blank" rel="noreferrer" aria-label={tr("Open")} className="rounded p-1 text-muted-foreground hover:text-foreground">
                        <ExternalLink className="size-4" />
                      </a>
                    ) : null}
                    <button type="button" onClick={() => remove(item.editionId)} disabled={pending} aria-label={tr("Remove")} className="rounded p-1 text-muted-foreground hover:text-destructive">
                      <X className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">{tr("Nothing in it yet. Add a publication from the list on the right.")}</p>
          )}
        </SettingsCard>

        <SettingsCard title={tr("Search engines")} description={tr("What a search result says. Left empty, the name and the line under it are used.")}>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="seo-title">{tr("Title")}</Label>
              <Input id="seo-title" value={form.seoTitle ?? ""} onChange={(e) => set("seoTitle", e.target.value || null)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seo-description">{tr("Description")}</Label>
              <Textarea id="seo-description" rows={2} value={form.seoDescription ?? ""} onChange={(e) => set("seoDescription", e.target.value || null)} />
            </div>
          </div>
        </SettingsCard>
      </div>

      <div className="space-y-4">
        <SettingsCard title={tr("Visibility")} description={tr("A draft is invisible however finished it looks.")}>
          <div className="space-y-3">
            <Toggle label={tr("Published")} hint={tr("Live at its address in the gallery")} checked={form.isPublished} onChange={(v) => set("isPublished", v)} />
            <Toggle label={tr("Featured")} hint={tr("On the gallery's front page")} checked={form.isFeatured} onChange={(v) => set("isFeatured", v)} />
            <div className="space-y-1.5">
              <Label htmlFor="pinned">{tr("Pinned order")}</Label>
              <Input id="pinned" type="number" min={0} max={99} value={form.pinnedOrder ?? ""} onChange={(e) => set("pinnedOrder", e.target.value === "" ? null : Number(e.target.value))} />
              <p className="text-2xs text-muted-foreground">{tr("Lower comes first among the featured. Empty means unpinned.")}</p>
            </div>
            <Button size="sm" onClick={save} loading={pending} className="w-full">{tr("Save")}</Button>
          </div>
        </SettingsCard>

        <SettingsCard title={tr("Add a publication")} description={tr("Only editions whose owner agreed, that are published, and that have a public page.")}>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Search by organization or title…")} className="h-8 text-xs" />
          <ul className="mt-2 max-h-80 divide-y divide-border overflow-y-auto scrollbar-thin">
            {shown.length ? (
              shown.slice(0, 50).map((candidate) => (
                <li key={candidate.editionId} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{candidate.label}</p>
                    <p className="truncate text-2xs text-muted-foreground">{candidate.organization}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => add(candidate.editionId)} disabled={pending} aria-label={tr("Add")}>
                    <Plus />
                  </Button>
                </li>
              ))
            ) : (
              <li className="py-3 text-xs text-muted-foreground">{tr("Nothing available. A title has to agree to be shown before its editions appear here.")}</li>
            )}
          </ul>
        </SettingsCard>

        <ConsentPanel publications={publications} pending={pending} />

        <SettingsCard title={tr("Delete")} description={tr("The collection goes; nobody's publication is touched.")}>
          <form action={deleteCollectionAction.bind(null, collection.id)}>
            <Button type="submit" variant="outline" size="sm" className="w-full text-destructive">
              <Trash2 /> {tr("Delete this collection")}
            </Button>
          </form>
        </SettingsCard>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-3 text-left">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-2xs text-muted-foreground">{hint}</span>
      </span>
      <span className={cn("mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors", checked ? "bg-brand" : "bg-muted")}>
        <span className={cn("size-4 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
      </span>
    </button>
  );
}

/**
 * Consent, where a curator can see it and only widen it where they are allowed to.
 *
 * A demo workspace is Briefly's own, so it can be switched on here. A real customer cannot: the
 * console offers to record a permission given elsewhere, which demands a note saying where, and
 * the customer can still withdraw it from their own screen.
 */
function ConsentPanel({ publications, pending }: { publications: Publication[]; pending: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<Record<string, string>>({});
  const waiting = publications.filter((publication) => publication.consent === "NONE");
  const granted = publications.filter((publication) => publication.consent !== "NONE");

  function apply(publication: Publication, consent: "NONE" | "PLATFORM_DEMO" | "PERMISSION") {
    start(async () => {
      const res = await setPlatformConsentAction(publication.id, consent, note[publication.id] ?? null);
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(res.message ?? tr("Saved"));
        router.refresh();
      }
    });
  }

  return (
    <SettingsCard title={tr("Who agreed")} description={tr("A customer turns this on themselves. Briefly may switch on its own demo workspaces, and record a permission given elsewhere.")}>
      {granted.length ? (
        <ul className="mb-3 space-y-1.5">
          {granted.map((publication) => (
            <li key={publication.id} className="flex items-start justify-between gap-2 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-medium">{publication.name}</span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {publication.organization} · {publication.consent === "CUSTOMER" ? tr("the customer agreed") : publication.consent === "PLATFORM_DEMO" ? tr("Briefly demo") : tr("permission recorded")}
                </span>
              </span>
              <button type="button" onClick={() => apply(publication, "NONE")} disabled={busy || pending} className="shrink-0 text-2xs text-muted-foreground hover:text-destructive">
                {tr("Withdraw")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">{tr("Titles that have not agreed")} ({waiting.length})</summary>
        <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
          {waiting.map((publication) => (
            <li key={publication.id} className="rounded-md border border-border p-2">
              <p className="truncate text-xs font-medium">{publication.name}</p>
              <p className="truncate text-2xs text-muted-foreground">{publication.organization}</p>
              {publication.isDemo ? (
                <Button size="sm" variant="outline" className="mt-1.5 w-full" onClick={() => apply(publication, "PLATFORM_DEMO")} disabled={busy || pending}>
                  {tr("Show as a Briefly demo")}
                </Button>
              ) : (
                <div className="mt-1.5 space-y-1.5">
                  <Input value={note[publication.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [publication.id]: e.target.value }))} placeholder={tr("Where was permission given?")} className="h-7 text-2xs" />
                  <Button size="sm" variant="outline" className="w-full" onClick={() => apply(publication, "PERMISSION")} disabled={busy || pending || !(note[publication.id] ?? "").trim()}>
                    {tr("Record their permission")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </details>
    </SettingsCard>
  );
}
