"use client";

import { useState, useTransition } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createContributorAction } from "@/app/(newsroom)/contributors/actions";
import { useUi } from "@/components/i18n/provider";

/**
 * A contributor, added right here.
 *
 * The screen that asks who you are inviting used to assume the people already existed. On a
 * workspace made ten minutes ago they do not: it showed "no contributor group exists yet", "of the
 * 0 people in the groups below" and an empty list, which is three ways of saying "there is nobody"
 * and no way of doing anything about it. Whichever way the rest are chosen, somebody typing a name
 * and an address here means them to be asked, so the person is created and ticked in one step.
 */
export function AddContributorInline({ onAdded, disabled }: { onAdded: (person: { id: string; name: string; email: string }) => void; disabled?: boolean }) {
  const tr = useUi();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();

  function add() {
    const first = firstName.trim();
    const last = lastName.trim();
    const address = email.trim();
    if (!first || !last || !address) {
      toast.error(tr("A first name, a last name and an email address."));
      return;
    }
    start(async () => {
      const result = await createContributorAction({ firstName: first, lastName: last, email: address });
      if (!result.ok) {
        toast.error(result.error, { description: result.fieldErrors ? Object.values(result.fieldErrors).flat().join(" · ") : undefined });
        return;
      }
      onAdded({ id: result.data.id, name: `${first} ${last}`, email: address });
      setFirstName("");
      setLastName("");
      setEmail("");
      setOpen(false);
      toast.success(tr("{name} is on the list and will be asked", { name: `${first} ${last}` }));
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)} data-testid="add-contributor-open">
        <UserPlus /> {tr("Add somebody")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-2">
      <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder={tr("First name")} aria-label={tr("First name")} className="h-8 w-32" disabled={pending} />
      <Input value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder={tr("Last name")} aria-label={tr("Last name")} className="h-8 w-32" disabled={pending} />
      <Input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        placeholder={tr("Email")}
        aria-label={tr("Email")}
        className="h-8 w-56"
        disabled={pending}
      />
      <Button type="button" size="sm" loading={pending} onClick={add} data-testid="add-contributor-save">
        {tr("Add")}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
        {tr("Cancel")}
      </Button>
    </div>
  );
}
