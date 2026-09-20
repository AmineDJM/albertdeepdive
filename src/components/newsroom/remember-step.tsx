"use client";

import { useEffect, useRef } from "react";
import { rememberStepAction } from "@/app/(newsroom)/editions/actions";

/**
 * Records that this screen was reached, once per visit.
 *
 * It draws nothing. The alternative was recording it when the button is pressed, which misses the
 * person who walked away from the screen they had just opened — the one most likely to need to be
 * put back where they were.
 */
export function RememberStep({ editionId, room }: { editionId: string; room: string }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const key = `${editionId}:${room}`;
    if (sent.current === key) return;
    sent.current = key;
    void rememberStepAction(editionId, room);
  }, [editionId, room]);
  return null;
}
