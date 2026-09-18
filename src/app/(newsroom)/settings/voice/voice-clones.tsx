"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, Trash2 } from "lucide-react";
import { requestVoiceCloneAction, revokeVoiceCloneAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useLocale, useUi } from "@/components/i18n/provider";
import { LANGUAGE_NAMES, type SpeechLanguage } from "@/lib/speech/language";
import { formatDate } from "@/lib/utils";

/**
 * A real person's voice, with their permission on record.
 *
 * The form asks for the consent in words and a confirmation before it asks for a recording, and the
 * list keeps the consent with the voice. Nothing here can be started by Briefly on its own.
 */

export type CloneView = { id: string; name: string; personName: string; relation: string; status: string; consentGrantedAt: string; error: string | null; language: string | null };

const RELATION_WORDS: Record<string, { en: string; fr: string }> = {
  founder: { en: "Founder", fr: "Fondateur·rice" },
  executive: { en: "Executive", fr: "Dirigeant·e" },
  employee: { en: "Employee", fr: "Salarié·e" },
  contributor: { en: "Contributor", fr: "Contributeur·rice" },
  other: { en: "Other", fr: "Autre" },
};

export function VoiceClones({ clones, languages }: { clones: CloneView[]; languages: SpeechLanguage[] }) {
  const tr = useUi();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const names = LANGUAGE_NAMES[locale];

  const submit = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    data.set("consentConfirmed", confirmed ? "true" : "false");
    startTransition(async () => {
      const result = await requestVoiceCloneAction(data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? tr("Done"));
      form.current?.reset();
      setConfirmed(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {clones.length ? (
        <ul className="space-y-2">
          {clones.map((clone) => (
            <li key={clone.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{clone.name}</span>
                <span className="text-muted-foreground">{clone.personName} · {RELATION_WORDS[clone.relation]?.[locale] ?? clone.relation}{clone.language ? ` · ${names[clone.language as SpeechLanguage] ?? clone.language}` : ""}</span>
                <Badge variant={clone.status === "READY" ? "success" : clone.status === "REVOKED" ? "muted" : clone.status === "FAILED" ? "destructive" : "info"}>{clone.status.toLowerCase()}</Badge>
                <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                  <ShieldCheck className="size-3" /> {tr("consent recorded")} {formatDate(clone.consentGrantedAt)}
                </span>
                {clone.error ? <span className="text-destructive">{clone.error}</span> : null}
              </span>
              {clone.status !== "REVOKED" ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(tr("Withdraw this voice? It is deleted at the provider and can no longer be used."))) {
                      startTransition(async () => {
                        const result = await revokeVoiceCloneAction(clone.id);
                        if (!result.ok) toast.error(result.error);
                        else {
                          toast.success(result.message ?? tr("Done"));
                          router.refresh();
                        }
                      });
                    }
                  }}
                >
                  <Trash2 />{" "}{tr("Withdraw")}</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form
        ref={form}
        className="space-y-3 rounded-lg border border-dashed border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="text-[13px] font-medium">{tr("Clone a voice, with consent")}</p>
        <p className="max-w-prose text-xs leading-5 text-muted-foreground">{tr("Only for a person who has agreed, in writing, to lend their voice to this workspace. Write their consent down here as they gave it; it stays with the voice, and withdrawing it deletes the voice.")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="clone-name">{tr("Name of the voice")}</Label>
            <Input id="clone-name" name="name" required placeholder={tr("Marie Dupont — CEO")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clone-person">{tr("The person")}</Label>
            <Input id="clone-person" name="personName" required placeholder={tr("Marie Dupont")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clone-relation">{tr("Who they are")}</Label>
            <NativeSelect id="clone-relation" name="relation" defaultValue="other">
              {Object.entries(RELATION_WORDS).map(([value, words]) => (
                <option key={value} value={value}>
                  {words[locale]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clone-language">{tr("Recorded in")}</Label>
            <NativeSelect id="clone-language" name="language" defaultValue="">
              <option value="">{tr("Not sure")}</option>
              {languages.map((code) => (
                <option key={code} value={code}>
                  {names[code]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clone-consent">{tr("Their consent, in their words")}</Label>
          <Textarea id="clone-consent" name="consentText" rows={3} required placeholder={tr("I, Marie Dupont, agree that Acme may reproduce my voice for its newsletters and films, until I say otherwise.")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clone-samples">{tr("Recordings")}</Label>
          <Input id="clone-samples" name="samples" type="file" accept="audio/*" multiple required />
          <p className="text-2xs leading-4 text-muted-foreground">{tr("One to five clean recordings of the person speaking, a minute or more in total, no music.")}</p>
        </div>
        <label className="flex items-start gap-2 text-xs">
          <Checkbox checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} className="mt-0.5" />
          <span>{tr("I confirm this person has given explicit consent to have their voice cloned for this workspace, and that I am recording it on their behalf.")}</span>
        </label>
        <Button type="submit" size="sm" loading={pending} disabled={!confirmed}>
          {tr("Clone the voice")}</Button>
      </form>
    </div>
  );
}
