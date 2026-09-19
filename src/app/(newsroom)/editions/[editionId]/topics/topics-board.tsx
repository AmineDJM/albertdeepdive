"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GitMerge, MessageCircleQuestion, Pencil, PenLine, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EmptyState } from "@/components/ui/empty-state";
import { useUi } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";
import type { Topic, TopicsBoard as Board } from "@/server/editorial/topics";
import { askForMoreAction, buildDraftAction, keepTopicAction, leaveTopicAction, mergeTopicsAction, moveTopicAction, renameTopicAction, undecideTopicAction } from "./actions";

const KEPT = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"];
const LEFT = ["REJECTED", "DROPPED"];

/**
 * What came in, as a list of decisions rather than a newsroom.
 *
 * The person at this step is answering one question about each thing on the list — are we running
 * this? — and everything on the card exists to answer it: what it is, who sent it, how many people
 * sent it, whether there is a picture. Nothing is written until they press the button at the
 * bottom, which is the promise that makes it safe to say no.
 */
export function TopicsBoard({ board, canEdit }: { board: Board; canEdit: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const result = await fn();
      if (!result.ok) toast.error(result.error ?? tr("That did not work"));
      else if (result.message) toast.success(result.message);
      router.refresh();
    });

  const waiting = board.topics.filter((topic) => topic.status === "CANDIDATE");
  const kept = board.topics.filter((topic) => KEPT.includes(topic.status));
  const left = board.topics.filter((topic) => LEFT.includes(topic.status));

  const card = (topic: Topic) => (
    <li key={topic.id} className={cn("rounded-lg border bg-card p-3", KEPT.includes(topic.status) ? "border-success/40" : LEFT.includes(topic.status) ? "border-border opacity-70" : "border-border")}>
      <div className="flex items-start gap-2.5">
        {canEdit && topic.status === "CANDIDATE" ? (
          <Checkbox
            className="mt-1"
            checked={selected.includes(topic.id)}
            onCheckedChange={(v) => setSelected((ids) => (v === true ? [...ids, topic.id] : ids.filter((id) => id !== topic.id)))}
            aria-label={`${tr("Select")} ${topic.title}`}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          {renaming === topic.id ? (
            <form
              className="flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => renameTopicAction(board.editionId, topic.id, draft));
                setRenaming(null);
              }}
            >
              <Input value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus className="h-7" maxLength={200} aria-label={tr("Topic title")} />
              <Button type="submit" size="sm" disabled={pending}>
                {tr("Save")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                {tr("Cancel")}
              </Button>
            </form>
          ) : (
            <p className="text-[14px] font-medium leading-snug">{topic.title}</p>
          )}
          {topic.summary ? <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{topic.summary}</p> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span>
              {topic.sources} {topic.sources === 1 ? tr("contribution") : tr("contributions")}
            </span>
            {topic.contributors.length ? <span>· {topic.contributors.slice(0, 3).join(", ")}{topic.contributors.length > 3 ? ` +${topic.contributors.length - 3}` : ""}</span> : null}
            {topic.pictures ? <span>· {topic.pictures} {topic.pictures === 1 ? tr("picture") : tr("pictures")}</span> : null}
            {topic.hasDraft ? <span>· {topic.wordCount} {tr("words written")}</span> : null}
          </p>
          {topic.moreRequested ? (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
              <MessageCircleQuestion className="size-3" />
              {tr("More info requested")}
              {topic.moreAskedAt ? ` · ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(topic.moreAskedAt))}` : ""}
            </p>
          ) : null}
          {asking === topic.id ? (
            <form
              className="mt-2 flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => askForMoreAction(board.editionId, topic.id, question));
                setAsking(null);
                setQuestion("");
              }}
            >
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                autoFocus
                className="h-7"
                maxLength={400}
                placeholder={tr("Which teams took part, and on what date?")}
                aria-label={tr("What would you like to know?")}
              />
              <Button type="submit" size="sm" disabled={pending || !question.trim()}>
                {tr("Send")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(null)}>
                {tr("Cancel")}
              </Button>
            </form>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && topic.status === "CANDIDATE" ? (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => keepTopicAction(board.editionId, topic.id))}>
                <Check /> {tr("Keep")}
              </Button>
              {topic.sources > 0 && !topic.moreRequested ? (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setAsking(topic.id);
                    setQuestion("");
                  }}
                  aria-label={tr("Ask for more")}
                  title={tr("Ask for more")}
                >
                  <MessageCircleQuestion />
                </Button>
              ) : null}
              <Button size="icon" variant="ghost" disabled={pending} onClick={() => run(() => leaveTopicAction(board.editionId, topic.id))} aria-label={tr("Leave this one out")} title={tr("Leave this one out")}>
                <X />
              </Button>
            </>
          ) : null}
          {canEdit && topic.status !== "CANDIDATE" && !topic.hasDraft ? (
            <Button size="icon" variant="ghost" disabled={pending} onClick={() => run(() => undecideTopicAction(board.editionId, topic.id))} aria-label={tr("Undo this decision")} title={tr("Undo this decision")}>
              <RotateCcw />
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              size="icon"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setRenaming(topic.id);
                setDraft(topic.title);
              }}
              aria-label={tr("Rename")}
              title={tr("Rename")}
            >
              <Pencil />
            </Button>
          ) : null}
          {canEdit && board.sections.length ? (
            <NativeSelect
              value={topic.sectionId ?? ""}
              onChange={(event) => run(() => moveTopicAction(board.editionId, topic.id, event.target.value || null))}
              disabled={pending}
              aria-label={tr("Move to a section")}
              className="h-7 w-[9rem] text-xs"
            >
              <option value="">{tr("No section")}</option>
              {board.sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </NativeSelect>
          ) : topic.sectionName ? (
            <Badge variant="muted">{topic.sectionName}</Badge>
          ) : null}
        </div>
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      {selected.length > 1 && canEdit ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-brand/40 bg-brand-soft/30 px-3 py-2">
          <span className="text-[13px]">
            {selected.length} {tr("selected — are they the same story?")}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                const [keep, ...rest] = selected;
                run(() => mergeTopicsAction(board.editionId, keep, rest));
                setSelected([]);
              }}
            >
              <GitMerge /> {tr("Merge into the first")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              {tr("Cancel")}
            </Button>
          </span>
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 text-[13px] font-semibold">
          {tr("To decide")} <span className="tabular text-muted-foreground">{waiting.length}</span>
        </h2>
        {waiting.length ? (
          <ul className="space-y-2">{waiting.map(card)}</ul>
        ) : (
          <EmptyState
            compact
            title={board.topics.length ? tr("Everything has been decided") : tr("Nothing has come in yet")}
            description={board.topics.length ? tr("Build the draft when you are ready.") : tr("Topics appear here as contributions arrive and are grouped.")}
          />
        )}
      </section>

      {kept.length ? (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">
            {tr("In the issue")} <span className="tabular text-muted-foreground">{kept.length}</span>
          </h2>
          <ul className="space-y-2">{kept.map(card)}</ul>
        </section>
      ) : null}

      {left.length ? (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-muted-foreground">
            {tr("Left out")} <span className="tabular">{left.length}</span>
          </h2>
          <ul className="space-y-2">{left.map(card)}</ul>
        </section>
      ) : null}

      {canEdit ? (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
          <p className="text-xs text-muted-foreground">
            {kept.length ? `${kept.length} ${tr("topic(s) kept")}` : tr("Nothing kept yet")}
            {waiting.length ? ` · ${waiting.length} ${tr("still to decide")}` : ""}
          </p>
          <Button disabled={pending || !kept.length} onClick={() => run(() => buildDraftAction(board.editionId))}>
            <PenLine /> {tr("Build draft")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
