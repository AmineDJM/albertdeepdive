import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { experienceOf } from "@/lib/experience";
import { GUIDED_PATH, nextFrom, previousFrom } from "@/lib/editorial/guided-path";
import { Button } from "@/components/ui/button";
import { GuidedFooter } from "./guided-footer";
import { RememberStep } from "./remember-step";
import { screenWords } from "./guided-words";
import { getUi } from "@/server/i18n/locale";

/**
 * The button at the bottom of a screen, and the only thing anybody has to press.
 *
 * Standard's problem was never a missing screen. It was that every screen ended in a choice: eight
 * rows each offering "Change", a tab bar, a timeline, and no answer at all to "and now?". So each
 * screen on the way ends the same way — where you are, what comes next in the words of the screen
 * it opens, and one button that goes there.
 *
 * It draws nothing in Advanced. Somebody who asked for every door open did not ask to be walked
 * through them in order, and the doors are still above.
 */
export async function GuidedNext({ editionId, room }: { editionId: string; room: string }) {
  const [tr, user] = await Promise.all([getUi(), getCurrentUser()]);
  if (experienceOf(user?.preferences) !== "standard") return null;
  const at = GUIDED_PATH.findIndex((screen) => screen.room === room);
  if (at < 0) return null;
  const words = screenWords(tr);
  const next = nextFrom(editionId, room);
  // The end of the path is a place too. A last screen that simply stops is the one moment a person
  // is most likely to wonder whether they missed a step.
  const back = previousFrom(editionId, room);
  const backTo = back ? { href: back.href, label: tr("Back") } : null;
  if (!next)
    return (
      <>
        <RememberStep editionId={editionId} room={room} />
        <GuidedFooter title={words[GUIDED_PATH[at].key].question} hint={tr("That is the whole of it. This edition is yours to send.")} back={backTo}>
          <Button asChild variant="outline" data-testid="guided-done-button">
            <Link href="/overview">{tr("Back to my newsletters")}</Link>
          </Button>
        </GuidedFooter>
      </>
    );
  return (
    <>
      <RememberStep editionId={editionId} room={room} />
      <GuidedFooter title={tr("Next: {question}", { question: words[GUIDED_PATH[at + 1].key].question })} hint={tr("Step {step} of {total}", { step: at + 1, total: GUIDED_PATH.length })} back={backTo}>
        <Button asChild size="lg" data-testid="guided-next-button">
          <Link href={next.href}>
            {words[GUIDED_PATH[at].key].cta} <ArrowRight />
          </Link>
        </Button>
      </GuidedFooter>
    </>
  );
}
