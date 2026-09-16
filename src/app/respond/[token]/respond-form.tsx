"use client";

import { useActionState } from "react";
import { CheckCircle2, ImagePlus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitAnswers, type RespondState } from "./actions";

type Item = { key: string; label: string };

const initial: RespondState = { status: "idle" };

export function RespondForm({ token, items }: { token: string; items: Item[] }) {
  const action = submitAnswers.bind(null, token);
  const [state, formAction, pending] = useActionState(action, initial);

  if (state.status === "success") {
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertTitle>Thank you, your answers are in the newsroom</AlertTitle>
        <AlertDescription>
          <p>
            {state.answered ?? 0} question{(state.answered ?? 0) === 1 ? "" : "s"} answered
            {state.attachments ? ` and ${state.attachments} photo${state.attachments === 1 ? "" : "s"} received` : ""}. The editors will add them to the story.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <ol className="flex flex-col gap-5">
        {items.map((item, index) => (
          <li key={item.key} className="flex flex-col gap-2">
            <Label htmlFor={`answer-${item.key}`} className="items-start gap-2 text-sm leading-snug">
              <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft font-mono text-[11px] font-semibold text-brand-foreground">{index + 1}</span>
              <span>{item.label}</span>
            </Label>
            <Textarea id={`answer-${item.key}`} name={`answer:${item.key}`} rows={3} placeholder="Your answer" className="min-h-20 text-sm" maxLength={5000} />
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2">
        <Label htmlFor="freeText" className="text-sm">
          Anything else we should know?
        </Label>
        <Textarea id="freeText" name="freeText" rows={4} placeholder="Names, dates, results, links… anything that helps the editors." className="min-h-24 text-sm" maxLength={10000} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="files" className="text-sm">
          <ImagePlus className="size-4 text-muted-foreground" /> Add photos (optional)
        </Label>
        <input id="files" name="files" type="file" accept="image/*" multiple className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-foreground hover:file:bg-muted" />
        <p className="text-xs text-muted-foreground">JPEG, PNG or WebP. By sending a photo you confirm the people pictured agree to appear in Albert&apos;s Deep Dive.</p>
      </div>
      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>We could not save your answers</AlertTitle>
          <AlertDescription>
            <p>{state.message}</p>
          </AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" size="lg" loading={pending} className="w-full sm:w-auto">
        Send my answers
      </Button>
    </form>
  );
}
