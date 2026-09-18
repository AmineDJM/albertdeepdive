"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Save, Undo2 } from "lucide-react";
import { saveBriefAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_HASHTAGS } from "@/lib/creative/laws";
import type { CreativeBrief, FrameBrief } from "@/lib/creative/brief";

/**
 * The words, editable. The look, not.
 *
 * A person may change what a frame says — a headline that is nearly right, a figure that should read
 * "€1.2M". They may not change what it looks like, because the look is the brand's and the brand is
 * set once, in Brand settings, for every pack at once. So the form has no colour, no size and no
 * font: it is headline, body, figure, attribution, items, caption and hashtags, which is exactly the
 * vocabulary the Art Director has. What comes out goes back through the same door the model's answer
 * came through, and a brief that cannot be rendered is refused with the sentences that say why.
 */
type Draft = { frames: FrameBrief[]; caption: string; hashtags: string };

const draftFrom = (brief: CreativeBrief): Draft => ({
  frames: brief.frames.map((frame) => ({ ...frame })),
  caption: brief.caption,
  hashtags: brief.hashtags.map((tag) => `#${tag}`).join(" "),
});

export function BriefEditor({ packId, brief, busy }: { packId: string; brief: CreativeBrief; busy: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(brief));
  const [problems, setProblems] = useState<string[]>([]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(brief));

  const setFrame = (index: number, patch: Partial<FrameBrief>) =>
    setDraft((current) => ({ ...current, frames: current.frames.map((frame, i) => (i === index ? { ...frame, ...patch } : frame)) }));

  const save = () =>
    startTransition(async () => {
      const next: CreativeBrief = {
        ...brief,
        frames: draft.frames.map(tidy),
        caption: draft.caption.trim(),
        hashtags: draft.hashtags
          .split(/[\s,]+/)
          .map((tag) => tag.replace(/^#+/, "").trim())
          .filter(Boolean),
      };
      const result = await saveBriefAction(packId, next);
      if (!result.ok) {
        setProblems(result.fieldErrors?.brief ?? [result.error]);
        toast.error(result.error);
        return;
      }
      setProblems([]);
      toast.success(result.message ?? "Saved");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {draft.frames.map((frame, index) => (
          <li key={index} className="rounded-lg border border-border bg-card p-3">
            <p className="mb-2 flex items-baseline gap-2 text-2xs text-muted-foreground">
              <span className="font-medium text-foreground">Frame {index + 1}</span>
              <span>
                {frame.layout.replace("_", " ")} · {frame.surface} · {frame.emphasis}
              </span>
            </p>
            <div className="space-y-2">
              <Input aria-label={`Frame ${index + 1} headline`} value={frame.headline} maxLength={180} onChange={(event) => setFrame(index, { headline: event.target.value })} />
              {frame.layout === "figure" ? (
                <Input aria-label={`Frame ${index + 1} figure`} placeholder="The number itself — €1.2M, 340, 3×" value={frame.figure ?? ""} maxLength={24} onChange={(event) => setFrame(index, { figure: event.target.value })} />
              ) : null}
              {frame.layout === "quote" ? (
                <Input aria-label={`Frame ${index + 1} attribution`} placeholder="Who said it" value={frame.attribution ?? ""} maxLength={180} onChange={(event) => setFrame(index, { attribution: event.target.value })} />
              ) : null}
              {frame.layout === "list" ? (
                <Textarea aria-label={`Frame ${index + 1} items`} placeholder="One item per line, two to five" value={(frame.items ?? []).join("\n")} onChange={(event) => setFrame(index, { items: event.target.value.split("\n") })} />
              ) : null}
              {frame.layout === "heading_body" || frame.layout === "cta" || frame.body ? (
                <Textarea aria-label={`Frame ${index + 1} body`} value={frame.body ?? ""} maxLength={420} onChange={(event) => setFrame(index, { body: event.target.value })} />
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
        <Textarea aria-label="Caption" placeholder="The post's own text" value={draft.caption} maxLength={2200} onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))} />
        <Input aria-label="Hashtags" placeholder={`Up to ${MAX_HASHTAGS} hashtags`} value={draft.hashtags} onChange={(event) => setDraft((current) => ({ ...current, hashtags: event.target.value }))} />
      </div>

      {problems.length ? (
        <ul className="space-y-1 rounded-lg border border-coral-soft bg-coral-soft/40 px-3.5 py-2.5 text-xs">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-coral-deep" />
              {problem}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!dirty || pending || busy} onClick={save}>
          <Save /> {pending ? "Saving…" : "Save and render"}
        </Button>
        <Button variant="ghost" size="sm" disabled={!dirty || pending} onClick={() => { setDraft(draftFrom(brief)); setProblems([]); }}>
          <Undo2 /> Undo changes
        </Button>
        <span className="text-2xs text-muted-foreground">{busy ? "Wait for the current render to finish." : "The look stays the brand's. Only the words change."}</span>
      </div>
    </div>
  );
}

/** Optional fields left blank are absent, not empty strings: the schema's `min(1)` is not a typo. */
function tidy(frame: FrameBrief): FrameBrief {
  const out: FrameBrief = { ...frame, headline: frame.headline.trim() };
  for (const key of ["body", "figure", "attribution", "alt"] as const) {
    const value = out[key]?.trim();
    if (value) out[key] = value;
    else delete out[key];
  }
  if (out.items) {
    const items = out.items.map((item) => item.trim()).filter(Boolean);
    if (items.length) out.items = items;
    else delete out.items;
  }
  return out;
}
