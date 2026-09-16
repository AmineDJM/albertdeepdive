"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Check, HelpCircle, Languages, Loader2, Plus, Quote, Save, Scissors, ShieldCheck, Sparkles, Trash2, Type, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ArticleStatusBadge } from "@/components/newsroom/status-badge";
import { approveArticleAction, commentOnArticleAction, explainBlockAction, requestChangesAction, restoreRevisionAction, runArticleActionAction, saveArticleAction, submitForReviewAction } from "@/app/(newsroom)/articles/[articleId]/actions";
import type { ArticleAction, ArticleProposal } from "@/server/editorial/articles";
import type { BlockExplanation } from "@/server/editorial/facts";
import { countWords, type ArticleBlock } from "@/lib/publication/document";
import { cn, relativeTime, truncate } from "@/lib/utils";

const AI_ACTIONS: { action: ArticleAction; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { action: "shorten", label: "Shorten", icon: Scissors, hint: "Tighten the text without losing a fact" },
  { action: "generate_headlines", label: "Generate 5 headlines", icon: Type, hint: "Alternative headlines in the house voice" },
  { action: "rewrite_headline", label: "Rewrite headline", icon: Type, hint: "One sharper headline" },
  { action: "improve_structure", label: "Improve structure", icon: Wand2, hint: "Reorder and add crossheads" },
  { action: "improve_english", label: "Preserve facts, improve English", icon: Wand2, hint: "Copy-edit only" },
  { action: "suggest_pull_quote", label: "Suggest pull quote", icon: Quote, hint: "Pick the strongest verbatim quote" },
  { action: "check_consistency", label: "Check factual consistency", icon: ShieldCheck, hint: "Compare every sentence with the fact sheet" },
  { action: "check_house_style", label: "Check house style", icon: ShieldCheck, hint: "Tone, capitalisation, British spelling" },
  { action: "translate", label: "Translate", icon: Languages, hint: "English ↔ French, quotes marked as translated" },
];

const BLOCK_LABELS: Record<string, string> = {
  paragraph: "Paragraph",
  crosshead: "Crosshead",
  pullquote: "Pull quote",
  list: "List",
  box: "Fact box",
  qa: "Question & answer",
  testimony: "Testimony",
  image: "Image",
  divider: "Divider",
};

type EditorArticle = {
  id: string;
  storyId: string;
  editionId: string;
  kicker: string | null;
  headline: string;
  standfirst: string | null;
  byline: string | null;
  body: ArticleBlock[];
  status: string;
  wordCount: number;
  currentRevision: number;
  headlineAlternatives: string[];
  warnings: { code: string; message: string; severity: string }[];
  manualEditRatio: number | null;
  lastEditedAt: Date | null;
  approvedAt: Date | null;
};

function newId() {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * How a block reads when it is collapsed to a preview: one line per item, unlike the canonical
 * `blockText`, which joins with spaces because it feeds word counts and matching, not display.
 */
function blockPreview(b: ArticleBlock): string {
  switch (b.type) {
    case "paragraph":
    case "crosshead":
    case "pullquote":
    case "testimony":
      return b.text;
    case "list":
      return b.items.join("\n");
    case "box":
      return [b.title, b.text, ...(b.items ?? [])].filter(Boolean).join("\n");
    case "qa":
      return `${b.question}\n${b.answer}`;
    case "image":
      return b.caption ?? "";
    default:
      return "";
  }
}

export function ArticleEditor({
  article,
  story,
  revisions,
  comments,
  canEdit,
  canApprove,
}: {
  article: EditorArticle;
  story: { id: string; title: string; status: string; sectionName: string | null; editionLabel: string };
  revisions: { version: number; createdAt: Date; createdByAi: boolean; createdByName: string | null; changeSummary: string | null; wordCount: number }[];
  comments: { id: string; body: string; createdAt: Date; userName: string | null }[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [kicker, setKicker] = useState(article.kicker ?? "");
  const [headline, setHeadline] = useState(article.headline);
  const [standfirst, setStandfirst] = useState(article.standfirst ?? "");
  const [byline, setByline] = useState(article.byline ?? "");
  const [blocks, setBlocks] = useState<ArticleBlock[]>(article.body);
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();
  const [aiPending, startAi] = useTransition();
  const [proposal, setProposal] = useState<ArticleProposal | null>(null);
  const [explanation, setExplanation] = useState<{ blockId: string; data: BlockExplanation } | null>(null);
  const [comment, setComment] = useState("");
  const [busyAction, setBusyAction] = useState<ArticleAction | null>(null);
  const lastSaved = useRef({ headline: article.headline, blocks: article.body });

  const words = useMemo(() => countWords(blocks), [blocks]);
  const locked = article.status === "LOCKED" || !canEdit;

  const mutate = useCallback((next: ArticleBlock[]) => {
    setBlocks(next);
    setDirty(true);
  }, []);

  function updateBlock(id: string, patch: Partial<ArticleBlock>) {
    mutate(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as ArticleBlock) : b)));
  }

  function moveBlock(index: number, delta: number) {
    const next = [...blocks];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    mutate(next);
  }

  function removeBlock(id: string) {
    mutate(blocks.filter((b) => b.id !== id));
  }

  function addBlock(type: ArticleBlock["type"], afterIndex: number) {
    const base = { id: newId() };
    const created: ArticleBlock =
      type === "crosshead"
        ? { ...base, type: "crosshead", text: "NEW CROSSHEAD" }
        : type === "pullquote"
          ? { ...base, type: "pullquote", text: "", attribution: "" }
          : type === "list"
            ? { ...base, type: "list", items: [""] }
            : type === "box"
              ? { ...base, type: "box", title: "In a nutshell", items: [""] }
              : type === "qa"
                ? { ...base, type: "qa", question: "QUESTION?", answer: "" }
                : type === "testimony"
                  ? { ...base, type: "testimony", text: "", speaker: "" }
                  : type === "divider"
                    ? { ...base, type: "divider" }
                    : { ...base, type: "paragraph", text: "" };
    const next = [...blocks];
    next.splice(afterIndex + 1, 0, created);
    mutate(next);
  }

  function save(extra?: { changeSummary?: string }) {
    startSave(async () => {
      const res = await saveArticleAction(
        article.id,
        { kicker: kicker || null, headline, standfirst: standfirst || null, byline: byline || null, body: blocks, changeSummary: extra?.changeSummary ?? null },
        { editionId: article.editionId, storyId: article.storyId },
      );
      if (res.ok) {
        toast.success(res.message);
        lastSaved.current = { headline, blocks };
        setDirty(false);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function runAi(action: ArticleAction) {
    setBusyAction(action);
    startAi(async () => {
      const res = await runArticleActionAction(article.id, action, action === "shorten" ? { targetWords: Math.max(120, Math.round(words * 0.75)) } : {});
      setBusyAction(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const p = res.data;
      if (p.kind === "issues") {
        toast.message(p.verdict ?? "Check finished", { description: `${p.issues?.length ?? 0} point(s) to look at` });
        setProposal(p);
        router.refresh();
        return;
      }
      setProposal(p);
    });
  }

  function applyProposal(p: ArticleProposal, choice?: string) {
    if (p.kind === "headline" && p.headline) setHeadline(p.headline);
    if (p.kind === "headlines" && choice) setHeadline(choice);
    if (p.kind === "blocks" && p.blocks) setBlocks(p.blocks);
    if (p.kind === "pullQuote" && p.pullQuote) {
      const quote: ArticleBlock = { id: newId(), type: "pullquote", text: p.pullQuote.text, attribution: p.pullQuote.attribution ?? undefined };
      const afterFirstParagraph = blocks.findIndex((b) => b.type === "paragraph");
      const next = [...blocks];
      next.splice(afterFirstParagraph >= 0 ? afterFirstParagraph + 1 : next.length, 0, quote);
      setBlocks(next);
    }
    setDirty(true);
    setProposal(null);
    toast.success("Proposal applied to your draft — review it and save.");
  }

  function explain(blockId: string) {
    startAi(async () => {
      const res = await explainBlockAction(article.id, blockId);
      if (res.ok) setExplanation({ blockId, data: res.data });
      else toast.error(res.error);
    });
  }

  return (
    <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* ── Editor ─────────────────────────────────────────────── */}
      <div className="min-w-0 border-r border-border">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/95 px-5 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <ArticleStatusBadge status={article.status} />
            <span className="text-2xs text-muted-foreground">
              {words} words · revision {article.currentRevision}
              {article.manualEditRatio !== null ? ` · ${Math.round(article.manualEditRatio * 100)}% edited by hand` : ""}
            </span>
            {dirty ? <Badge variant="warning">Unsaved changes</Badge> : null}
          </div>
          <div className="flex items-center gap-1.5">
            {canEdit ? (
              <Button size="sm" onClick={() => save()} loading={saving} disabled={!dirty}>
                <Save /> Save
              </Button>
            ) : null}
            {canEdit && article.status !== "READY_FOR_REVIEW" && article.status !== "APPROVED" ? (
              <Button size="sm" variant="outline" disabled={saving} onClick={() => startSave(async () => { const r = await submitForReviewAction(article.id, { editionId: article.editionId, storyId: article.storyId }); if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error); })}>
                Send for review
              </Button>
            ) : null}
            {canApprove && article.status !== "APPROVED" ? (
              <Button size="sm" variant="brand" disabled={saving} onClick={() => startSave(async () => { const r = await approveArticleAction(article.id, {}, { editionId: article.editionId, storyId: article.storyId }); if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error, { description: "Resolve the disputed facts on the story first, or approve with a reason." }); })}>
                <Check /> Approve
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
          {article.warnings.length ? (
            <ul className="space-y-1">
              {article.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-2.5 py-1.5 text-xs">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="kicker">Kicker</Label>
            <Input id="kicker" value={kicker} onChange={(e) => { setKicker(e.target.value); setDirty(true); }} disabled={locked} placeholder="People discover — student" className="label-caps h-8 text-brand" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="headline">Headline</Label>
            <Textarea id="headline" value={headline} onChange={(e) => { setHeadline(e.target.value); setDirty(true); }} disabled={locked} rows={2} className="font-display text-2xl leading-tight font-semibold" />
            <p className={cn("text-2xs", headline.length > 90 ? "text-destructive" : "text-muted-foreground")}>{headline.length} characters {headline.length > 90 ? "— too long for print (max 90)" : ""}</p>
            {article.headlineAlternatives.length ? (
              <div className="flex flex-wrap gap-1">
                {article.headlineAlternatives.filter((h) => h !== headline).slice(0, 4).map((h) => (
                  <button key={h} type="button" disabled={locked} onClick={() => { setHeadline(h); setDirty(true); }} className="rounded-sm border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:border-brand hover:text-foreground">
                    {truncate(h, 60)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="standfirst">Standfirst</Label>
            <Textarea id="standfirst" value={standfirst} onChange={(e) => { setStandfirst(e.target.value); setDirty(true); }} disabled={locked} rows={2} className="font-serif text-[15px]" placeholder="20 to 35 words that add information to the headline." />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="byline">Byline</Label>
            <Input id="byline" value={byline} onChange={(e) => { setByline(e.target.value); setDirty(true); }} disabled={locked} placeholder="Milan Viallet" className="h-8" />
          </div>

          <Separator />

          <ol className="space-y-2.5">
            {blocks.map((block, index) => (
              <li key={block.id} className="group relative rounded-lg border border-transparent p-2 transition-colors hover:border-border hover:bg-card">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="label-caps">{BLOCK_LABELS[block.type] ?? block.type}</span>
                  <div className="ml-auto hidden items-center gap-0.5 group-hover:flex">
                    <Button size="icon-xs" variant="ghost" title="Why is this here?" aria-label="Why is this here?" onClick={() => explain(block.id)}>
                      <HelpCircle />
                    </Button>
                    {canEdit && !locked ? (
                      <>
                        <Button size="icon-xs" variant="ghost" title="Move up" aria-label="Move up" onClick={() => moveBlock(index, -1)}>
                          <ArrowUp />
                        </Button>
                        <Button size="icon-xs" variant="ghost" title="Move down" aria-label="Move down" onClick={() => moveBlock(index, 1)}>
                          <ArrowDown />
                        </Button>
                        <Button size="icon-xs" variant="ghost" title="Delete block" aria-label="Delete block" onClick={() => removeBlock(block.id)}>
                          <Trash2 />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                <BlockFields block={block} disabled={locked} onChange={(patch) => updateBlock(block.id, patch)} />

                {canEdit && !locked ? (
                  <div className="mt-1 hidden flex-wrap gap-1 group-hover:flex">
                    {(["paragraph", "crosshead", "pullquote", "list", "box", "qa"] as const).map((t) => (
                      <button key={t} type="button" onClick={() => addBlock(t, index)} className="inline-flex items-center gap-0.5 rounded-sm border border-dashed border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:border-brand hover:text-foreground">
                        <Plus className="size-2.5" /> {BLOCK_LABELS[t]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          {canEdit && !locked && blocks.length === 0 ? (
            <Button variant="outline" size="sm" onClick={() => addBlock("paragraph", -1)}>
              <Plus /> Add the first paragraph
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside className="min-w-0 space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin">
        <section>
          <h3 className="label-caps mb-1.5">Story</h3>
          <Link href={`/stories/${story.id}`} className="block rounded-md border border-border bg-card px-2.5 py-2 text-xs hover:border-brand/50">
            <p className="font-medium">{story.title}</p>
            <p className="text-2xs text-muted-foreground">
              {story.editionLabel} · {story.sectionName ?? "Unassigned"} · sources and facts
            </p>
          </Link>
        </section>

        <section>
          <h3 className="label-caps mb-1.5">Assistant</h3>
          <p className="mb-1.5 text-2xs text-muted-foreground">Every action returns a proposal. Nothing changes until you accept it.</p>
          <div className="grid gap-1">
            {AI_ACTIONS.map((a) => (
              <Button key={a.action} size="xs" variant="outline" className="justify-start" disabled={aiPending || locked} onClick={() => runAi(a.action)} title={a.hint}>
                {busyAction === a.action ? <Loader2 className="animate-spin" /> : <a.icon />}
                {a.label}
              </Button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="label-caps mb-1.5">Revisions ({revisions.length})</h3>
          <ul className="space-y-1">
            {revisions.slice(0, 8).map((r) => (
              <li key={r.version} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-2xs">
                <span className="min-w-0">
                  <span className="font-medium">v{r.version}</span> {r.createdByAi ? <Badge variant="info">AI</Badge> : <span className="text-muted-foreground">{r.createdByName ?? "editor"}</span>}
                  <span className="block truncate text-muted-foreground">{r.changeSummary ?? `${r.wordCount} words`}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-muted-foreground">{relativeTime(r.createdAt)}</span>
                  {canEdit && r.version !== article.currentRevision ? (
                    <Button size="icon-xs" variant="ghost" title={`Restore v${r.version}`} aria-label={`Restore v${r.version}`} onClick={() => startSave(async () => { const res = await restoreRevisionAction(article.id, r.version, { editionId: article.editionId, storyId: article.storyId }); if (res.ok) { toast.success(res.message); router.refresh(); } else toast.error(res.error); })}>
                      <ArrowUp />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="label-caps mb-1.5">Desk notes</h3>
          {comments.map((c) => (
            <div key={c.id} className="mb-1 rounded-md border border-border px-2 py-1 text-2xs">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{c.userName ?? "Someone"}</span>
                <span className="text-muted-foreground">{relativeTime(c.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">{c.body}</p>
            </div>
          ))}
          {canEdit ? (
            <form
              className="mt-1.5 space-y-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                startSave(async () => {
                  const res = await commentOnArticleAction(article.id, article.editionId, comment);
                  if (res.ok) {
                    setComment("");
                    toast.success(res.message);
                    router.refresh();
                  } else toast.error(res.error);
                });
              }}
            >
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Note for the desk… use @userId to mention" className="text-xs" />
              <Button size="xs" type="submit" variant="outline" disabled={!comment.trim()}>
                Add note
              </Button>
            </form>
          ) : null}
        </section>

        {canApprove && article.status === "READY_FOR_REVIEW" ? (
          <section>
            <h3 className="label-caps mb-1.5">Review</h3>
            <RequestChangesForm articleId={article.id} editionId={article.editionId} storyId={article.storyId} />
          </section>
        ) : null}
      </aside>

      <ProposalDialog proposal={proposal} onClose={() => setProposal(null)} onApply={applyProposal} />
      <ExplanationDialog explanation={explanation} onClose={() => setExplanation(null)} />
    </div>
  );
}

function BlockFields({ block, disabled, onChange }: { block: ArticleBlock; disabled: boolean; onChange: (patch: Partial<ArticleBlock>) => void }) {
  switch (block.type) {
    case "paragraph":
      return <Textarea value={block.text} disabled={disabled} onChange={(e) => onChange({ text: e.target.value } as Partial<ArticleBlock>)} rows={3} className="font-serif text-[14px] leading-6" />;
    case "crosshead":
      return <Input value={block.text} disabled={disabled} onChange={(e) => onChange({ text: e.target.value.toUpperCase() } as Partial<ArticleBlock>)} className="h-8 text-xs font-semibold tracking-wide uppercase" />;
    case "pullquote":
      return (
        <div className="space-y-1 border-l-2 border-brand pl-3">
          <Textarea value={block.text} disabled={disabled} onChange={(e) => onChange({ text: e.target.value } as Partial<ArticleBlock>)} rows={2} className="font-display text-base italic" />
          <Input value={block.attribution ?? ""} disabled={disabled} onChange={(e) => onChange({ attribution: e.target.value } as Partial<ArticleBlock>)} placeholder="Attribution" className="h-7 text-xs" />
        </div>
      );
    case "testimony":
      return (
        <div className="space-y-1 rounded-md bg-muted/40 p-2">
          <Textarea value={block.text} disabled={disabled} onChange={(e) => onChange({ text: e.target.value } as Partial<ArticleBlock>)} rows={3} className="font-serif text-[14px] italic" />
          <Input value={block.speaker ?? ""} disabled={disabled} onChange={(e) => onChange({ speaker: e.target.value } as Partial<ArticleBlock>)} placeholder="Speaker" className="h-7 text-xs" />
        </div>
      );
    case "qa":
      return (
        <div className="space-y-1">
          <Input value={block.question} disabled={disabled} onChange={(e) => onChange({ question: e.target.value.toUpperCase() } as Partial<ArticleBlock>)} className="h-8 text-xs font-semibold uppercase" />
          <Textarea value={block.answer} disabled={disabled} onChange={(e) => onChange({ answer: e.target.value } as Partial<ArticleBlock>)} rows={3} className="font-serif text-[14px]" />
        </div>
      );
    case "list":
      return (
        <Textarea
          value={block.items.join("\n")}
          disabled={disabled}
          onChange={(e) => onChange({ items: e.target.value.split("\n") } as Partial<ArticleBlock>)}
          rows={Math.max(2, block.items.length)}
          className="font-serif text-[14px]"
          placeholder="One item per line"
        />
      );
    case "box":
      return (
        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
          <Input value={block.title ?? ""} disabled={disabled} onChange={(e) => onChange({ title: e.target.value } as Partial<ArticleBlock>)} placeholder="In a nutshell" className="h-7 text-xs font-semibold" />
          <Textarea value={(block.items ?? []).join("\n")} disabled={disabled} onChange={(e) => onChange({ items: e.target.value.split("\n") } as Partial<ArticleBlock>)} rows={Math.max(2, (block.items ?? []).length)} className="text-xs" placeholder="One item per line" />
        </div>
      );
    case "image":
      return (
        <div className="rounded-md border border-dashed border-border p-2 text-2xs text-muted-foreground">
          Image block · asset {truncate(block.assetId, 12)}
          <Input value={block.caption ?? ""} disabled={disabled} onChange={(e) => onChange({ caption: e.target.value } as Partial<ArticleBlock>)} placeholder="Caption" className="mt-1 h-7 text-xs" />
        </div>
      );
    default:
      return <div className="h-px bg-border" />;
  }
}

function ProposalDialog({ proposal, onClose, onApply }: { proposal: ArticleProposal | null; onClose: () => void; onApply: (p: ArticleProposal, choice?: string) => void }) {
  if (!proposal) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            <Sparkles className="mr-1 inline size-4" />
            {AI_ACTIONS.find((a) => a.action === proposal.action)?.label ?? proposal.action}
          </DialogTitle>
          <DialogDescription>{proposal.reason ?? proposal.verdict ?? "A proposal — accept it to put it in your draft, or dismiss it."}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto scrollbar-thin">
          {proposal.kind === "headline" && proposal.headline ? <p className="font-display text-xl font-semibold">{proposal.headline}</p> : null}

          {proposal.kind === "headlines" && proposal.headlines ? (
            <ul className="space-y-1.5">
              {proposal.headlines.map((h) => (
                <li key={h.text}>
                  <button type="button" onClick={() => onApply(proposal, h.text)} className="w-full rounded-md border border-border px-3 py-2 text-left hover:border-brand hover:bg-accent/40">
                    <span className="font-display block text-[15px] font-semibold">{h.text}</span>
                    <span className="text-2xs text-muted-foreground">{h.angle} · {h.text.length} characters</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {proposal.kind === "pullQuote" ? (
            proposal.pullQuote ? (
              <blockquote className="font-display border-l-2 border-brand pl-3 text-base italic">
                &ldquo;{proposal.pullQuote.text}&rdquo;
                <footer className="mt-1 text-2xs text-muted-foreground not-italic">{proposal.pullQuote.attribution}</footer>
              </blockquote>
            ) : (
              <p className="text-xs text-muted-foreground">No quote is strong enough to pull out.</p>
            )
          ) : null}

          {proposal.kind === "blocks" && proposal.blocks ? (
            <>
              {proposal.changes?.length ? (
                <ul className="mb-2 space-y-0.5 rounded-md bg-muted/50 p-2 text-2xs text-muted-foreground">
                  {proposal.changes.map((c, i) => (
                    <li key={i}>· {c}</li>
                  ))}
                </ul>
              ) : null}
              <div className="space-y-1.5 rounded-md border border-border p-3">
                {proposal.blocks.map((b) => (
                  <div key={b.id} className="text-xs">
                    <span className="label-caps">{BLOCK_LABELS[b.type] ?? b.type}</span>
                    <p className="font-serif whitespace-pre-wrap">{blockPreview(b)}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {proposal.kind === "issues" ? (
            proposal.issues?.length ? (
              <ul className="space-y-1.5">
                {proposal.issues.map((issue, i) => (
                  <li key={i} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={issue.severity === "error" ? "destructive" : issue.severity === "warning" ? "warning" : "info"}>{issue.code}</Badge>
                    </div>
                    <p className="mt-1">{issue.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-success">Nothing to flag. Every statement matches the sources.</p>
            )
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {proposal.kind === "issues" ? "Close" : "Dismiss"}
          </Button>
          {proposal.kind !== "issues" && proposal.kind !== "headlines" ? (
            <Button onClick={() => onApply(proposal)}>
              <Check /> Apply to my draft
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExplanationDialog({ explanation, onClose }: { explanation: { blockId: string; data: BlockExplanation } | null; onClose: () => void }) {
  if (!explanation) return null;
  const { data } = explanation;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Why is this here?</DialogTitle>
          <DialogDescription>{data.note ?? "The sources behind this passage."}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto scrollbar-thin">
          {data.facts.length ? (
            <section>
              <h4 className="label-caps mb-1">Facts</h4>
              <ul className="space-y-1">
                {data.facts.map((f) => (
                  <li key={f.id} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                    <p>{f.statement}</p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">{f.confidence.toLowerCase().replace(/_/g, " ")}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.quotes.length ? (
            <section>
              <h4 className="label-caps mb-1">Quotes</h4>
              <ul className="space-y-1">
                {data.quotes.map((q) => (
                  <li key={q.id} className="rounded-md border border-border px-2.5 py-1.5 text-xs italic">
                    &ldquo;{q.text}&rdquo; <span className="not-italic text-muted-foreground">— {q.speakerName ?? "unattributed"}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h4 className="label-caps mb-1">Submissions</h4>
            {data.submissions.length ? (
              <ul className="space-y-1">
                {data.submissions.map((sub) => (
                  <li key={sub.id} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                    <p className="font-medium">{sub.title}</p>
                    <p className="text-2xs text-muted-foreground">{sub.contributorName ?? "Unknown"}</p>
                    {sub.excerpt ? <p className="mt-1 text-2xs italic text-muted-foreground">&ldquo;{sub.excerpt}&rdquo;</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-warning">No source is recorded for this block. Check it before publication.</p>
            )}
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestChangesForm({ articleId, editionId, storyId }: { articleId: string; editionId: string; storyId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!note.trim()) return;
        start(async () => {
          const res = await requestChangesAction(articleId, note, { editionId, storyId });
          if (res.ok) {
            setNote("");
            toast.success(res.message);
            router.refresh();
          } else toast.error(res.error);
        });
      }}
    >
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What should change before approval?" className="text-xs" />
      <Button size="xs" type="submit" variant="outline" loading={pending} disabled={!note.trim()}>
        <X /> Request changes
      </Button>
    </form>
  );
}
