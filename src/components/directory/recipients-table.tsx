"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/newsroom/data-table";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { RecipientEditor, type RecipientEditorValue } from "./recipient-editor";
import { deleteRecipientAction, setRecipientActiveAction } from "@/app/(newsroom)/directory/actions";
import { enumLabel } from "@/lib/utils";
import type { AUDIENCE_SEGMENTS } from "@/lib/constants";

export type RecipientRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  segment: (typeof AUDIENCE_SEGMENTS)[number];
  organisation: string | null;
  campusId: string | null;
  isActive: boolean;
  tags: string[];
  notes: string | null;
  campus: { id: string; name: string; colour: string | null } | null;
};

function toValue(r: RecipientRow): RecipientEditorValue {
  return { id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email, segment: r.segment, organisation: r.organisation, campusId: r.campusId, isActive: r.isActive, tags: r.tags, notes: r.notes };
}

export function RecipientsTable({ rows, campuses }: { rows: RecipientRow[]; campuses: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<RecipientRow | null>(null);

  function toggleActive(r: RecipientRow) {
    startTransition(async () => {
      const res = await setRecipientActiveAction(r.id, !r.isActive);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  function remove(r: RecipientRow) {
    setConfirm(null);
    startTransition(async () => {
      const res = await deleteRecipientAction(r.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        dense
        empty={{ title: "No recipients match", description: "Adjust the filters, add a recipient or import a file.", icon: Users }}
        columns={[
          {
            key: "name",
            header: "Recipient",
            cell: (r) => (
              <div className="min-w-0">
                <div className="font-medium">{`${r.firstName} ${r.lastName}`.trim() || "—"}</div>
                <div className="truncate text-2xs text-muted-foreground">{r.email}</div>
              </div>
            ),
          },
          { key: "segment", header: "Segment", cell: (r) => <Badge variant="outline">{enumLabel(r.segment)}</Badge> },
          { key: "campus", header: "Campus", cell: (r) => (r.campus ? <CampusChip name={r.campus.name} colour={r.campus.colour} /> : <span className="text-2xs text-muted-foreground">School-wide</span>) },
          { key: "organisation", header: "Organisation", cell: (r) => <span className="line-clamp-1 text-xs text-muted-foreground">{r.organisation || "—"}</span> },
          { key: "tags", header: "Tags", cell: (r) => <span className="line-clamp-1 text-2xs text-muted-foreground">{r.tags.join(", ") || "—"}</span> },
          {
            key: "active",
            header: "Active",
            align: "center",
            cell: (r) => <Switch checked={r.isActive} disabled={pending} onCheckedChange={() => toggleActive(r)} aria-label={r.isActive ? `Deactivate ${r.email}` : `Activate ${r.email}`} />,
          },
          {
            key: "actions",
            header: "",
            align: "right",
            cell: (r) => (
              <div className="flex items-center justify-end gap-1.5">
                <RecipientEditor value={toValue(r)} campuses={campuses} />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${r.email}`} onClick={() => setConfirm(r)}>
                  <Trash2 />
                </Button>
              </div>
            ),
          },
        ]}
      />

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirm ? `${confirm.firstName} ${confirm.lastName}`.trim() || confirm.email : "this recipient"}?</AlertDialogTitle>
            <AlertDialogDescription>They are removed from the audience directory and will no longer receive the magazine. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => confirm && remove(confirm)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
