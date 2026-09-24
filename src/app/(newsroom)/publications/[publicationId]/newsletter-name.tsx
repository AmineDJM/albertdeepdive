"use client";

import { InlineRename } from "@/components/newsroom/inline-rename";
import { useUi } from "@/components/i18n/provider";
import { updatePublicationAction } from "../actions";

/** The newsletter's name, changed where it is read. */
export function NewsletterName({ publicationId, name, canRename }: { publicationId: string; name: string; canRename: boolean }) {
  const tr = useUi();
  return <InlineRename value={name} label={tr("Rename the newsletter")} disabled={!canRename} className="text-[15px] font-semibold tracking-tight" onSave={(next) => updatePublicationAction(publicationId, { name: next })} />;
}
