"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, PenLine, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { assignSectionAction, draftArticleAction, dropStoryAction, selectStoryAction, setCoverStoryAction } from "@/app/(newsroom)/editions/[editionId]/stories/actions";

const SELECTED = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"];

export function StoryActions({
  editionId,
  story,
  sections,
  hasArticle,
  articleId,
}: {
  editionId: string;
  story: { id: string; status: string; sectionId: string | null; isCover: boolean; priority: number; targetLength: string };
  sections: { id: string; name: string }[];
  hasArticle: boolean;
  articleId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isSelected = SELECTED.includes(story.status);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        router.refresh();
      } else toast.error(res.error ?? "Failed");
    });
  }

  return (
    <>
      <NativeSelect aria-label="Section" className="h-8 w-40 text-xs" value={story.sectionId ?? ""} disabled={pending} onChange={(e) => run(() => assignSectionAction(editionId, story.id, e.target.value || null))}>
        <option value="">Unassigned</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
      {!isSelected ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => selectStoryAction(editionId, story.id))}>
          <Check /> Select for the issue
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dropStoryAction(editionId, story.id))}>
          <X /> Drop
        </Button>
      )}
      {hasArticle && articleId ? (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/articles/${articleId}`}>Open the editor</Link>
        </Button>
      ) : isSelected ? (
        <Button size="sm" variant="brand" loading={pending} onClick={() => run(() => draftArticleAction(editionId, story.id))}>
          <PenLine /> Write the draft
        </Button>
      ) : null}
      {!story.isCover && isSelected ? (
        <Button size="icon-sm" variant="ghost" title="Make this the cover story" aria-label="Make this the cover story" disabled={pending} onClick={() => run(() => setCoverStoryAction(editionId, story.id))}>
          <Star />
        </Button>
      ) : null}
    </>
  );
}
