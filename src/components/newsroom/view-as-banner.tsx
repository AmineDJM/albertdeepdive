"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { leaveViewAsAction } from "@/app/(admin)/admin/actions";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { useUi } from "@/components/i18n/provider";

/**
 * A reminder that you are not yourself.
 *
 * Unmissable on purpose. Somebody who forgets they are simulating a campus editor will file a bug
 * about a missing button, and somebody who forgets they are inside a customer's workspace will edit
 * a real edition believing it is a test. A full-width bar in a colour used nowhere else costs eight
 * pixels and prevents both.
 *
 * Leaving is one click and always available, because the failure mode of a support tool is being
 * stuck inside it.
 */
export function ViewAsBanner({ role, userName }: { role: Role; userName?: string }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2 bg-coral px-3 py-1.5 text-white">
      <Eye className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs">
        {tr("You are seeing Briefly as")}{" "}{userName ? <strong className="font-semibold">{userName}</strong> : "a"} <strong className="font-semibold">{ROLE_LABELS[role]}</strong>{tr(". Anything you change is recorded under your own name.")}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await leaveViewAsAction();
            router.refresh();
          })
        }
        className="shrink-0 rounded-sm bg-white/20 px-2 py-0.5 text-xs font-medium transition-colors hover:bg-white/30 disabled:opacity-60"
      >
        {pending ? "Leaving…" : "Back to my own view"}
      </button>
    </div>
  );
}
