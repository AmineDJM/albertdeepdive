"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BriefEditor } from "@/components/newsroom/brief-editor";
import { SettingsCard } from "@/components/settings/key-value";
import { Textarea } from "@/components/ui/textarea";
import { GuidedFooter } from "@/components/newsroom/guided-footer";
import { saveBriefAction } from "./actions";
import type { EditionBrief } from "@/lib/campaigns/brief";
import { useUi } from "@/components/i18n/provider";

/**
 * The questions, and one button that saves them and moves on.
 *
 * A "Save" that leaves you where you were, followed by a "Next" that would lose the change if you
 * pressed the wrong one, is a trap with two doors. So the button forward saves first and only
 * moves if that worked. The explicit Save stays for the person who wants to stop here.
 */
export function AskForm({
  editionId,
  initial,
  initialIntro,
  contributors,
  canManage,
  next,
  nextLabel,
  nextHint,
  title,
  back,
}: {
  editionId: string;
  initial: EditionBrief;
  /** The word at the top of every invitation and reminder. Empty means Briefly writes it. */
  initialIntro: string;
  contributors: { id: string; name: string }[];
  canManage: boolean;
  /** Where the path goes after this screen, or null in Advanced, where there is no path. */
  next: string | null;
  nextLabel: string;
  nextHint: string;
  title: string;
  back?: { href: string; label: string } | null;
}) {
  const tr = useUi();
  const router = useRouter();
  const [brief, setBrief] = useState<EditionBrief>(initial);
  const [intro, setIntro] = useState(initialIntro);
  const [saving, startSave] = useTransition();
  const [moving, startMove] = useTransition();
  const dirty = useMemo(() => JSON.stringify(brief) !== JSON.stringify(initial) || intro !== initialIntro, [brief, initial, intro, initialIntro]);

  async function persist(): Promise<boolean> {
    const result = await saveBriefAction(editionId, brief, intro);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    return true;
  }

  return (
    <div className="space-y-4">
      <BriefEditor brief={brief} onChange={setBrief} readOnly={!canManage} contributors={contributors} />

      {/*
        * The word at the top of the invitation, beside the questions it introduces.
        *
        * It used to sit on the screen about who is being asked, under the deadline — two screens
        * away from the questions it opens. Somebody writing "tell us what happened around you this
        * month" is thinking about what they want, not about logistics.
        */}
      <SettingsCard title={tr("Anything to tell them?")} description={tr("Added at the top of every invitation and reminder email. Leave it empty and Briefly writes it.")}>
        <Textarea
          value={intro}
          onChange={(event) => setIntro(event.target.value)}
          disabled={!canManage}
          rows={3}
          maxLength={2000}
          placeholder={tr("Tell us what happened around you this month…")}
          aria-label={tr("Invitation message")}
        />
      </SettingsCard>

      <GuidedFooter title={title} hint={dirty ? tr("Not saved yet") : nextHint} back={back}>
        <div className="flex items-center gap-2">
          {canManage && dirty ? (
            <Button
              variant="outline"
              loading={saving}
              onClick={() =>
                startSave(async () => {
                  if (await persist()) {
                    toast.success(tr("Saved"));
                    router.refresh();
                  }
                })
              }
            >
              <Save /> {tr("Save")}
            </Button>
          ) : null}
          {next ? (
            <Button
              size="lg"
              loading={moving}
              data-testid="guided-next-button"
              onClick={() =>
                startMove(async () => {
                  if (canManage && dirty && !(await persist())) return;
                  router.push(next);
                })
              }
            >
              {nextLabel} <ArrowRight />
            </Button>
          ) : null}
        </div>
      </GuidedFooter>
    </div>
  );
}
