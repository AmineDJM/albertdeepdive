"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SettingsCard } from "@/components/settings/key-value";
import { cancelTransferAction, confirmTransferAction, startTransferAction } from "./actions";
import { useUi } from "@/components/i18n/provider";

type Destination = { id: string; name: string; isPersonal: boolean };
type Pending = { id: string; ownerEmail: string; recipientEmail: string; expiresAt: string; attempts: number; maxAttempts: number };

/**
 * Handing a newsletter to another workspace, in two halves that cannot be done by one person.
 *
 * The screen never sees either code. It asks for both at once because the owner types both — one
 * from their own inbox, one read out by whoever is receiving — and checking them separately would
 * let each be guessed separately.
 */
export function TransferForm({
  publicationId,
  publicationName,
  destinations,
  preview,
  pending,
}: {
  publicationId: string;
  publicationName: string;
  destinations: Destination[];
  preview: { editions: number; subscribers: number; contributors: number };
  pending: Pending | null;
}) {
  const tr = useUi();
  const router = useRouter();
  const [to, setTo] = useState(destinations[0]?.id ?? "");
  const [ownerCode, setOwnerCode] = useState("");
  const [recipientCode, setRecipientCode] = useState("");
  const [busy, start] = useTransition();

  function begin() {
    start(async () => {
      const result = await startTransferAction(publicationId, to);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  function confirm() {
    if (!pending) return;
    start(async () => {
      const result = await confirmTransferAction(pending.id, ownerCode, recipientCode);
      if (!result.ok) {
        toast.error(result.error);
        setOwnerCode("");
        setRecipientCode("");
        router.refresh();
        return;
      }
      toast.success(result.message);
      // It is not this workspace's newsletter any more, so there is nothing here to come back to.
      router.push("/publications");
    });
  }

  function abandon() {
    if (!pending) return;
    start(async () => {
      await cancelTransferAction(pending.id);
      toast.success(tr("Transfer cancelled. Nothing moved."));
      router.refresh();
    });
  }

  if (pending) {
    return (
      <SettingsCard title={tr("Two codes are waiting")} description={tr("Nothing has moved. Both codes have to be entered here, by you.")}>
        <div className="space-y-4" data-testid="transfer-codes">
          <ul className="space-y-1.5 text-[13px]">
            <li className="flex items-center gap-2">
              <Mail className="size-3.5 shrink-0 text-muted-foreground" />
              {tr("Your code went to {email}", { email: pending.ownerEmail })}
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
              {tr("The other code went to {email} — ask them to read it to you", { email: pending.recipientEmail })}
            </li>
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="owner-code">{tr("Your code")}</Label>
              <Input id="owner-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={ownerCode} onChange={(e) => setOwnerCode(e.target.value)} placeholder="000000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recipient-code">{tr("Their code")}</Label>
              <Input id="recipient-code" inputMode="numeric" autoComplete="off" maxLength={6} value={recipientCode} onChange={(e) => setRecipientCode(e.target.value)} placeholder="000000" />
            </div>
          </div>
          {pending.attempts > 0 ? (
            <p className="text-2xs text-warning">{tr("{count} attempts left before this transfer is cancelled", { count: pending.maxAttempts - pending.attempts })}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} disabled={ownerCode.length < 6 || recipientCode.length < 6} onClick={confirm} data-testid="confirm-transfer">
              {tr("Hand it over")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={abandon} data-testid="cancel-transfer">
              {tr("Cancel the transfer")}
            </Button>
          </div>
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title={tr("Hand this newsletter to somebody else")}
      description={tr("It moves with everything that belongs to it, and stops being yours.")}
    >
      <div className="space-y-4">
        {/* Said before the decision, not after: what leaves is the point of the screen. */}
        <ul className="grid gap-1.5 text-[13px] sm:grid-cols-3">
          <li>
            <span className="tabular font-semibold">{preview.editions}</span> {preview.editions === 1 ? tr("edition") : tr("editions")}
          </li>
          <li>
            <span className="tabular font-semibold">{preview.subscribers}</span> {preview.subscribers === 1 ? tr("reader") : tr("readers")}
          </li>
          <li>
            <span className="tabular font-semibold">{preview.contributors}</span> {preview.contributors === 1 ? tr("contributor") : tr("contributors")}
          </li>
        </ul>
        <p className="text-2xs text-muted-foreground">
          {tr("Its name, its look, its library and its public links go too. A reader who also follows another of your newsletters keeps that one.")}
        </p>

        {destinations.length ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-to">{tr("Hand it to")}</Label>
              <NativeSelect id="transfer-to" value={to} onChange={(e) => setTo(e.target.value)} data-testid="transfer-destination">
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                    {destination.isPersonal ? ` · ${tr("personal")}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button size="sm" loading={busy} disabled={!to} onClick={begin} data-testid="start-transfer">
              {tr("Send the two codes")} <ArrowRight />
            </Button>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground" data-testid="no-destination">
            {tr("You are not a member of another workspace yet. Transfers go to a workspace you belong to, so that somebody there can agree to receive {name}.", { name: publicationName })}
          </p>
        )}
      </div>
    </SettingsCard>
  );
}
