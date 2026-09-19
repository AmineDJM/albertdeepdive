import { HelpCircle, Sparkles, Target } from "lucide-react";
import type { Ask } from "@/lib/campaigns/brief";

/**
 * What this contributor was asked for, said plainly at the top of their form.
 *
 * The form used to open with a blank page and a hopeful sentence, which is a hard thing to answer.
 * Most people do not need a form; they need to be told what would be useful. So the questions put
 * to them and the topic assigned to them come first, in the editor's own words, and the form
 * underneath is where the answers go.
 *
 * Topics assigned to somebody else never reach this component — the server filters them out —
 * because seeing one is an invitation to write a piece that somebody else is already writing.
 */
export function WhatWeAsked({ asks, openContributions }: { asks: Ask[]; openContributions: boolean }) {
  if (!asks.length && openContributions) return null;

  const questions = asks.filter((ask) => ask.kind === "QUESTION");
  const topics = asks.filter((ask) => ask.kind === "TOPIC");

  return (
    <section className="mt-4 rounded-xl border border-border bg-muted/40 p-4" aria-label="What we asked you for">
      {topics.length > 0 && (
        <div className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Target className="size-3.5" /> {topics.length === 1 ? "Your topic" : "Your topics"}
          </h2>
          <ul className="space-y-1.5">
            {topics.map((ask) => (
              <li key={ask.id} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-[14px] font-medium">{ask.text}</p>
                {ask.hint ? <p className="mt-0.5 text-[13px] text-muted-foreground">{ask.hint}</p> : null}
                <p className="mt-1 text-2xs text-muted-foreground">
                  {ask.wants.includes("PHOTO") && ask.wants.includes("TEXT")
                    ? "A few words and a photograph"
                    : ask.wants.includes("PHOTO")
                      ? "A photograph"
                      : "A few words"}
                  {ask.required ? " · asked of you in particular" : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {questions.length > 0 && (
        <div className={topics.length ? "mt-4 space-y-2" : "space-y-2"}>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <HelpCircle className="size-3.5" /> {questions.length === 1 ? "The question we are asking" : "The questions we are asking"}
          </h2>
          <ul className="space-y-1.5">
            {questions.map((ask) => (
              <li key={ask.id} className="rounded-md border border-border bg-card px-3 py-2">
                <p className="text-[14px]">{ask.text}</p>
                {ask.hint ? <p className="mt-0.5 text-[13px] text-muted-foreground">{ask.hint}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-[13px] text-muted-foreground">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" />
        {openContributions
          ? "And anything else worth telling — the best thing in most issues is the thing nobody thought to ask about."
          : "This month we are only collecting the above."}
      </p>
    </section>
  );
}
