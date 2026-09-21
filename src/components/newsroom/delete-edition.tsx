"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { deleteEditionsAction } from "@/app/(newsroom)/editions/actions";
import { useUi } from "@/components/i18n/provider";

/**
 * Removing one edition, from the edition itself.
 *
 * It was possible only from the list of all editions, with a tick box and a bulk bar — a screen
 * Standard does not have at all, so a person who had just made an edition by mistake had no way to
 * unmake it. The moment somebody decides an issue should not exist is the moment they are looking
 * at it, so the control belongs here.
 *
 * It says what goes rather than asking "are you sure": stories, submissions, the campaign and the
 * rendered files go; the media library and the contributors are the workspace's and stay. An
 * edition that is already out says so too, because somebody may be holding a link to it.
 */
export function DeleteEdition({ editionId, label, published }: { editionId: string; label: string; published: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending} className="text-muted-foreground hover:text-destructive" data-testid="delete-edition">
          <Trash2 /> {tr("Delete this edition")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tr("Delete {label}?", { label })}</AlertDialogTitle>
          <AlertDialogDescription>
            {published
              ? tr("This edition has been published. Deleting it removes the issue, its stories and the files people may still have a link to. Your media library and your contributors stay. This cannot be undone.")
              : tr("Its stories, the contributions it collected, its campaign and its rendered files go with it. Your media library and your contributors stay. This cannot be undone.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tr("Keep it")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-delete-edition"
            onClick={() =>
              start(async () => {
                const result = await deleteEditionsAction([editionId]);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(result.message);
                // Push only: the action has already revalidated /overview, so a refresh on top of
                // it would fetch the same data twice.
                //
                // It does not silence the NOT_FOUND this logs. A server action re-renders the
                // route it was called from, and that route is the edition that no longer exists,
                // so the server records a 404 for a page nobody will see — the push has already
                // moved on. Silencing it means redirecting from inside the action, and the action
                // is shared with the bulk bar in the content hub, which must stay where it is.
                // Left alone deliberately: it is a line in the log, not something the reader meets.
                router.push("/overview");
              })
            }
          >
            {tr("Delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
