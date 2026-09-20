"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BriefEditor } from "@/components/newsroom/brief-editor";
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
  contributors,
  canManage,
  next,
  nextLabel,
  nextHint,
  title,
}: {
  editionId: string;
  initial: EditionBrief;
  contributors: { id: string; name: string }[];
  canManage: boolean;
  /** Where the path goes after this screen, or null in Advanced, where there is no path. */
  next: string | null;
  nextLabel: string;
  nextHint: string;
  title: string;
}) {
  const tr = useUi();
  const router = useRouter();
  const [brief, setBrief] = useState<EditionBrief>(initial);
  const [saving, startSave] = useTransition();
  const [moving, startMove] = useTransition();
  const dirty = useMemo(() => JSON.stringify(brief) !== JSON.stringify(initial), [brief, initial]);

  async function persist(): Promise<boolean> {
    const result = await saveBriefAction(editionId, brief);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    return true;
  }

  return (
    <div className="space-y-4">
      <BriefEditor brief={brief} onChange={setBrief} readOnly={!canManage} contributors={contributors} />

      <GuidedFooter title={title} hint={dirty ? tr("Not saved yet") : nextHint}>
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
