"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { deletePublicationAction, updatePublicationAction } from "@/app/(newsroom)/publications/actions";
import { useUi } from "@/components/i18n/provider";

/**
 * Removing a newsletter, and being honest about what that costs.
 *
 * A title with issues behind it is not a row: those issues were sent to people, and an edition's
 * link to its title is deliberately not a cascade so that tidying the list of titles cannot make
 * published work disappear by accident.
 *
 * So there are two answers and the screen offers both by name. **Archive** keeps everything and
 * stops the title being worked on — the right answer for a newsletter that ran for three years.
 * **Delete with its editions** is the other one, and a person is entitled to it for the title they
 * started by mistake in March; it names the number going with it, and asks once more.
 */
export function DeletePublication({ publicationId, name, editionCount }: { publicationId: string; name: string; editionCount: number }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  function remove(withEditions: boolean) {
    start(async () => {
      const result = await deletePublicationAction(publicationId, withEditions);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(result.message);
      // As above: the action revalidated, and refreshing would re-fetch the title we just deleted.
      router.push("/overview");
    });
  }

  function archive() {
    start(async () => {
      const result = await updatePublicationAction(publicationId, { status: "ARCHIVED" });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success(tr("{name} is archived. Nothing was deleted.", { name }));
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending} className="text-muted-foreground hover:text-destructive" data-testid="delete-publication">
          <Trash2 /> {tr("Delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("Delete {name}?", { name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {editionCount === 0
              ? tr("Nothing has been published under it. Its subscribers and its public links go with it. This cannot be undone.")
              : editionCount === 1
                ? tr("It has 1 edition. Deleting the newsletter deletes that edition too — its stories, its contributions and its rendered files. Your media library and your contributors stay. This cannot be undone.")
                : tr("It has {count} editions. Deleting the newsletter deletes them too — their stories, their contributions and their rendered files. Your media library and your contributors stay. This cannot be undone.", { count: editionCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <AlertDialogCancel>{tr("Keep it")}</AlertDialogCancel>
          <div className="flex flex-wrap items-center gap-2">
            {editionCount > 0 ? (
              // The softer answer, named rather than implied: a title that really ran belongs in
              // the archive, and somebody reaching for Delete may not know that is an option.
              <Button variant="outline" size="sm" disabled={pending} onClick={archive} data-testid="archive-publication">
                {tr("Archive it instead")}
              </Button>
            ) : null}
            <AlertDialogAction data-testid="confirm-delete-publication" onClick={() => remove(editionCount > 0)}>
              {editionCount > 0 ? tr("Delete it and its editions") : tr("Delete")}
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
