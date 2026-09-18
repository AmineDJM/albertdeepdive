"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { signOutEverywhereAction } from "../../actions";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/i18n/provider";

/** End every session this account holds — the button for a lost laptop or a leaked password. */
export function SessionControls({ userId, active }: { userId: string; active: number }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending || active === 0}
      onClick={() =>
        startTransition(async () => {
          const result = await signOutEverywhereAction(userId);
          if (!result.ok) {
            toast.error(result.error ?? tr("That did not work"));
            return;
          }
          toast.success(result.message ?? tr("Done"));
          router.refresh();
        })
      }
    >
      <LogOut />{" "}{tr("Sign out everywhere")}</Button>
  );
}
