"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Check, Globe, Link2, Sparkles } from "lucide-react";
import { confirmOnboardingAction, discoverAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { BrieflyLogo } from "@/components/brand/briefly-mark";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/components/i18n/provider";
import type { ActionResult } from "@/lib/action-result";
import type { DiscoveredOrganization } from "@/server/tenancy/discovery";
import { ORGANIZATION_TYPE_LABELS, organizationTypes } from "@/lib/tenancy/types";

const SOCIAL_LABELS: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram", x: "X", youtube: "YouTube", facebook: "Facebook" };

/** A logo we found on someone else's server. If it will not load, show nothing rather than a broken icon. */
function RemoteLogo({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={cn("size-12 shrink-0 rounded-md object-contain", className)} onError={() => setFailed(true)} />;
}

/**
 * Which of the marks on the page is the logo.
 *
 * A header holds the organisation's mark, its partners' marks, an app-store badge and a flag for
 * the language switcher. Ranking narrows that to a shortlist; only the person whose logo it is can
 * finish the job, and it takes them one click.
 */
function LogoChoice({ candidates, value, onPick, label }: { candidates: DiscoveredOrganization["logoCandidates"]; value: string; onPick: (url: string) => void; label: string }) {
  if (candidates.length < 2) return null;
  return (
    <div className="space-y-2">
      <p className="label-caps">{label}</p>
      <div className="flex flex-wrap gap-2">
        {candidates.map((candidate) => (
          <button
            key={candidate.url}
            type="button"
            onClick={() => onPick(candidate.url)}
            aria-pressed={value === candidate.url}
            aria-label={candidate.alt || candidate.url}
            className={cn(
              "flex h-14 w-20 items-center justify-center rounded-md border bg-card p-1.5 transition",
              value === candidate.url ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-foreground/30",
            )}
          >
            <RemoteLogo src={candidate.url} className="size-auto max-h-full max-w-full" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Two steps, one decision.
 *
 * Step one asks for a website; step two shows what Briefly worked out and lets the person correct
 * it. Everything discovered is pre-filled and editable rather than presented as a questionnaire,
 * because the point of onboarding is that nobody has to fill in twenty fields to see their first
 * edition.
 */
export function OnboardingFlow({ suggestedTimezone }: { suggestedTimezone: string }) {
  const router = useRouter();
  const t = useTranslations();
  const [discovery, discover, discovering] = useActionState<ActionResult<DiscoveredOrganization> | null, FormData>(discoverAction, null);
  const [confirmState, confirm, confirming] = useActionState<ActionResult<{ organizationId: string }> | null, FormData>(confirmOnboardingAction, null);
  const [manual, setManual] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);

  const found = discovery?.ok ? discovery.data : null;
  const chosenLogo = logo ?? found?.logoUrl ?? "";
  const step = found || manual ? 2 : 1;

  useEffect(() => {
    if (confirmState?.ok) router.push("/overview");
  }, [confirmState, router]);

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-16">
      <div className="mb-10 flex items-center gap-2.5">
        <BrieflyLogo height={26} />
      </div>

      {step === 1 ? (
        <form action={discover} className="space-y-6">
          <div>
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">{t("onboarding.websiteTitle")}</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
              {t("onboarding.websiteBody")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="website">{t("onboarding.website")}</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="website" name="website" placeholder="acme.com" autoFocus autoComplete="url" className="pl-9" aria-invalid={!!(discovery && !discovery.ok)} />
            </div>
            {discovery && !discovery.ok ? <ErrorNote message={discovery.error} /> : null}
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="lg" loading={discovering}>
              {discovering ? t("onboarding.reading") : t("common.continue")}
              {!discovering ? <ArrowRight className="size-4" /> : null}
            </Button>
            <button type="button" onClick={() => setManual(true)} className="text-[13px] text-muted-foreground underline-offset-4 hover:underline">
              {t("onboarding.enterManually")}
            </button>
          </div>
        </form>
      ) : (
        <form action={confirm} className="space-y-6">
          <div>
            <h1 className="flex items-center gap-2 text-[28px] leading-tight font-semibold tracking-[-0.02em]">
              {found ? (
                <>
                  <Sparkles className="size-6 text-muted-foreground" /> {t("onboarding.learnedTitle")}
                </>
              ) : (
                t("onboarding.manualTitle")
              )}
            </h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
              {found ? t("onboarding.learnedBody") : t("onboarding.manualBody")}
            </p>
          </div>

          {found?.colours.length ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              {chosenLogo ? <RemoteLogo src={chosenLogo} /> : null}
              <div className="min-w-0 flex-1">
                <p className="label-caps">{t("onboarding.yourColours")}</p>
                <div className="mt-1.5 flex gap-1.5">
                  {found.colours.map((c) => (
                    <span key={c} className="size-6 rounded-md border border-black/10" style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {found?.logoCandidates.length ? (
            <LogoChoice candidates={found.logoCandidates} value={chosenLogo} onPick={setLogo} label={t("onboarding.whichLogo")} />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">{t("onboarding.organizationName")}</Label>
              <Input id="name" name="name" required defaultValue={found?.name ?? ""} placeholder="Acme" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type">{t("onboarding.type")}</Label>
              <NativeSelect id="type" name="type" defaultValue={found?.type ?? "COMPANY"}>
                {organizationTypes.map((value) => (
                  <option key={value} value={value}>
                    {ORGANIZATION_TYPE_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="locale">{t("onboarding.language")}</Label>
              <NativeSelect id="locale" name="locale" defaultValue={found?.locale ?? "en"}>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">{t("onboarding.whatYouDo")}</Label>
              <Textarea id="description" name="description" rows={2} defaultValue={found?.description ?? ""} placeholder={t("onboarding.whatYouDoPlaceholder")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="publicationName">{t("onboarding.whatWillYouPublish")}</Label>
              <Input id="publicationName" name="publicationName" required defaultValue={found?.name ? `${found.name} Weekly` : ""} placeholder="Acme Weekly" />
              <p className="text-xs text-muted-foreground">{t("onboarding.publicationHint")}</p>
            </div>
          </div>

          {found && Object.keys(found.links).length > 1 ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="label-caps flex items-center gap-1.5">
                <Link2 className="size-3" /> {t("onboarding.whereYouPost")}
              </p>
              <ul className="mt-2 space-y-1">
                {Object.entries(found.links)
                  .filter(([key]) => key !== "website")
                  .map(([key, value]) => (
                    <li key={key} className="flex items-center gap-2 text-[13px]">
                      <Check className="size-3.5 shrink-0 text-emerald-600" />
                      <span className="w-20 shrink-0 text-muted-foreground">{SOCIAL_LABELS[key] ?? key}</span>
                      <span className="truncate text-muted-foreground">{value.replace(/^https?:\/\/(www\.)?/, "")}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <input type="hidden" name="website" value={found?.url ?? ""} />
          <input type="hidden" name="logoUrl" value={chosenLogo} />
          <input type="hidden" name="profile" value={JSON.stringify(found?.profile ?? {})} />
          <input type="hidden" name="faviconUrl" value={found?.faviconUrl ?? ""} />
          <input type="hidden" name="colours" value={JSON.stringify(found?.colours ?? [])} />
          <input type="hidden" name="fonts" value={JSON.stringify(found?.fonts ?? [])} />
          <input type="hidden" name="links" value={JSON.stringify(found?.links ?? {})} />
          <input type="hidden" name="timezone" value={suggestedTimezone} />

          {confirmState && !confirmState.ok ? <ErrorNote message={confirmState.error} /> : null}

          <div className={cn("flex items-center gap-3")}>
            <Button type="submit" size="lg" loading={confirming}>
              {confirming ? t("onboarding.creating") : t("onboarding.confirm")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
