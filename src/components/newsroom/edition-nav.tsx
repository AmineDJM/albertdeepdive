"use client";

import { useExperience } from "@/components/experience/provider";
import type { StepState } from "@/lib/editorial/edition-steps";
import { EditionTabs } from "./edition-tabs";
import { EditionTimeline } from "./edition-timeline";
import type { EditionDoor } from "./nav";

/**
 * One way around an edition, not two.
 *
 * There were two rows here: the doors, and the five steps under them. They overlapped, and the
 * overlap was worse than clutter — "Sujets" appeared in both and went to two different pages,
 * while Valider and Diffuser went to the same one. A person cannot learn a menu that contradicts
 * itself, and adding a second menu to explain the first is not how you fix the first.
 *
 * So each mode gets the navigation that suits the question it is asking. Standard asks "what do I
 * do next", and the answer is the five steps, in order, with the one you are on lit — the
 * navigation and the progress are the same object because for this person they are the same
 * question. Advanced asks "take me to the flatplan", and the answer is the doors.
 *
 * Neither mode loses anything: every room behind a door is still one link away, and the header
 * above says where the edition stands in both.
 */
export function EditionNav({
  editionId,
  doors,
  analyticsHref,
  steps,
}: {
  editionId: string;
  doors: EditionDoor[];
  analyticsHref: string | null;
  steps: StepState[];
}) {
  const mode = useExperience();
  if (mode === "standard") return <EditionTimeline editionId={editionId} steps={steps} />;
  return <EditionTabs editionId={editionId} doors={doors} analyticsHref={analyticsHref} />;
}
