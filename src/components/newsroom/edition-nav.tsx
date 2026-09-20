"use client";

import { useExperience } from "@/components/experience/provider";
import { EditionTabs } from "./edition-tabs";
import type { EditionDoor } from "./nav";

/**
 * One way around an edition, and in Standard, none.
 *
 * There were two rows here, then one, and the one that stayed was still wrong: a five-step bar
 * that read "Contributors" while the page under it showed the topics. A bar that has to disagree
 * with the screen beneath it to keep showing progress is not navigation — it is a second opinion,
 * and the reader has to work out which of the two is lying before they can do anything.
 *
 * So Standard has no bar at all. The edition's own screen is the map: the short list of decisions,
 * each with what Briefly chose and a way to change it, and one button at the bottom that goes
 * forward. Advanced keeps the doors, because Advanced is asking to be taken somewhere by name.
 */
export function EditionNav({ editionId, doors, analyticsHref }: { editionId: string; doors: EditionDoor[]; analyticsHref: string | null }) {
  const mode = useExperience();
  if (mode === "standard") return null;
  return (
    <div className="px-5 pb-2">
      <EditionTabs editionId={editionId} doors={doors} analyticsHref={analyticsHref} />
    </div>
  );
}
