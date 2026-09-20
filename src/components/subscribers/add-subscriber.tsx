"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { addSubscriberAction } from "@/app/(newsroom)/subscribers/actions";
import { useUi } from "@/components/i18n/provider";

export type TitleChoice = { id: string; name: string };

/**
 * One reader, typed in.
 *
 * A newsroom that already has its readers should not have to ask four hundred people to sign up
 * again, so the publisher may add them — and the dialog says plainly that adding somebody here
 * counts as their consent, because that is what it is.
 */
export function AddSubscriber({ titles }: { titles: TitleChoice[] }) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [locale, setLocale] = useState<"en" | "fr">("fr");
  const [chosen, setChosen] = useState<string[]>(titles.length === 1 ? [titles[0].id] : []);
  const [resubscribe, setResubscribe] = useState(false);

  function submit() {
    start(async () => {
      const result = await addSubscriberAction({ email, firstName, lastName, locale, publicationIds: chosen, resubscribe });
      if (!result.ok) {
        toast.error(result.error, { description: result.fieldErrors ? Object.values(result.fieldErrors).flat().join(" · ") : undefined });
        return;
      }
      if (result.data.skipped) {
        toast.warning(result.message ?? tr("That address unsubscribed before."));
        return;
      }
      toast.success(result.message ?? tr("Added"));
      setEmail("");
      setFirstName("");
      setLastName("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> {tr("Add a reader")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("Add a reader")}</DialogTitle>
          <DialogDescription>{tr("They go on the list as confirmed, because you are the one saying they asked for it. Every email still carries an unsubscribe link.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="sub-email">{tr("Email")}</Label>
            <Input id="sub-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="lecteur@exemple.fr" autoComplete="off" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sub-first">{tr("First name")}</Label>
              <Input id="sub-first" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </div>
            <div>
              <Label htmlFor="sub-last">{tr("Last name")}</Label>
              <Input id="sub-last" value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="sub-locale">{tr("Language")}</Label>
            <NativeSelect id="sub-locale" value={locale} onChange={(event) => setLocale(event.target.value === "fr" ? "fr" : "en")}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </NativeSelect>
          </div>
          {titles.length ? (
            <div>
              <Label>{tr("Newsletters")}</Label>
              <ul className="mt-1 space-y-1">
                {titles.map((title) => (
                  <li key={title.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted/60">
                      <Checkbox
                        checked={chosen.includes(title.id)}
                        onCheckedChange={(on) => setChosen((current) => (on === true ? [...current, title.id] : current.filter((id) => id !== title.id)))}
                        aria-label={title.name}
                      />
                      {title.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={resubscribe} onCheckedChange={(on) => setResubscribe(on === true)} aria-label={tr("Put them back if they unsubscribed")} />
            {tr("Put them back if they unsubscribed")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tr("Cancel")}
          </Button>
          <Button onClick={submit} loading={pending} disabled={!email.trim()}>
            {tr("Add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
