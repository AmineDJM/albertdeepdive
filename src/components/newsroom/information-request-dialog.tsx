"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestStoryInformationAction } from "@/app/(newsroom)/stories/[storyId]/actions";

/**
 * "Request information": the editor picks the gaps, the contributor gets a pre-filled link and
 * their answer comes back as a follow-up submission attached to the story.
 */
export function InformationRequestDialog({
  editionId,
  storyId,
  storyTitle,
  contributor,
  items,
}: {
  editionId: string;
  storyId: string;
  storyTitle: string;
  contributor: { id: string; name: string };
  items: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState<Set<string>>(() => new Set(items.map((i) => i.key)));
  const [extra, setExtra] = useState("");
  const [message, setMessage] = useState(`Hello, we are preparing the article about "${storyTitle}" for the next issue of Albert's Deep Dive and a few details are still missing. Could you help us fill the gaps below? It takes two minutes.`);

  const selected = items.filter((i) => checked.has(i.key));
  const extraItems = extra
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label, i) => ({ key: `extra_${i + 1}`, label }));
  const all = [...selected, ...extraItems];

  function submit() {
    startTransition(async () => {
      const res = await requestStoryInformationAction({ storyId, contributorId: contributor.id, message, items: all });
      if (res.ok) {
        toast.success("Request sent", { description: `${contributor.name} received a personal link.` });
        setOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline">
          <Send /> Request information
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Request more information</DialogTitle>
          <DialogDescription>
            {contributor.name} will receive an email with a secure link. Their answers come back attached to this story, ready for review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
          </div>

          {items.length ? (
            <div className="space-y-1.5">
              <Label>What is missing</Label>
              <ul className="space-y-1 rounded-md border border-border p-2">
                {items.map((item) => (
                  <li key={item.key}>
                    <label className="flex items-start gap-2 text-xs">
                      <Checkbox
                        className="mt-0.5"
                        checked={checked.has(item.key)}
                        onCheckedChange={(v) =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (v === true) next.add(item.key);
                            else next.delete(item.key);
                            return next;
                          })
                        }
                      />
                      <span>{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="extra-questions">Other questions (one per line)</Label>
            <Textarea id="extra-questions" value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} placeholder="Who took the photograph?&#10;What was the final score?" />
          </div>

          <p className="text-2xs text-muted-foreground">{all.length} question{all.length === 1 ? "" : "s"} will be sent.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!all.length || !message.trim()}>
            <Send /> Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
