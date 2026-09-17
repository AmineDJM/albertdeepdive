"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Check, Globe, Link2, Sparkles } from "lucide-react";
import { confirmOnboardingAction, discoverAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { BrieflyMark } from "@/components/brand/briefly-mark";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";
import type { DiscoveredOrganization } from "@/server/tenancy/discovery";

const TYPES = [
  ["COMPANY", "Company"],
  ["SCHOOL", "School"],
  ["UNIVERSITY", "University"],
  ["ASSOCIATION", "Association"],
  ["COMMUNITY", "Community"],
  ["INVESTOR", "Investment firm"],
  ["MEDIA", "Media"],
  ["INSTITUTION", "Institution"],
  ["OTHER", "Other"],
] as const;

const SOCIAL_LABELS: Record<string, string> = { linkedin: "LinkedIn", instagram: "Instagram", x: "X", youtube: "YouTube", facebook: "Facebook" };

/** A logo we found on someone else's server. If it will not load, show nothing rather than a broken icon. */
function RemoteLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="size-12 shrink-0 rounded-md object-contain" onError={() => setFailed(true)} />;
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
  const [discovery, discover, discovering] = useActionState<ActionResult<DiscoveredOrganization> | null, FormData>(discoverAction, null);
  const [confirmState, confirm, confirming] = useActionState<ActionResult<{ organizationId: string }> | null, FormData>(confirmOnboardingAction, null);
  const [manual, setManual] = useState(false);

  const found = discovery?.ok ? discovery.data : null;
  const step = found || manual ? 2 : 1;

  useEffect(() => {
    if (confirmState?.ok) router.push("/overview");
  }, [confirmState, router]);

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-16">
      <div className="mb-10 flex items-center gap-2.5">
        <BrieflyMark className="size-7" />
        <span className="text-[17px] font-semibold tracking-[-0.02em]">Briefly</span>
      </div>

      {step === 1 ? (
        <form action={discover} className="space-y-6">
          <div>
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">Let&rsquo;s start with your website.</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
              Briefly reads what your organization already publishes — your name, your logo, your colours and where you post — so you don&rsquo;t have to set any of it up.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="website" name="website" placeholder="acme.com" autoFocus autoComplete="url" className="pl-9" aria-invalid={!!(discovery && !discovery.ok)} />
            </div>
            {discovery && !discovery.ok ? <ErrorNote message={discovery.error} /> : null}
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="lg" loading={discovering}>
              {discovering ? "Reading your site…" : "Continue"}
              {!discovering ? <ArrowRight className="size-4" /> : null}
            </Button>
            <button type="button" onClick={() => setManual(true)} className="text-[13px] text-muted-foreground underline-offset-4 hover:underline">
              I&rsquo;ll enter the details myself
            </button>
          </div>
        </form>
      ) : (
        <form action={confirm} className="space-y-6">
          <div>
            <h1 className="flex items-center gap-2 text-[28px] leading-tight font-semibold tracking-[-0.02em]">
              {found ? (
                <>
                  <Sparkles className="size-6 text-muted-foreground" /> We learned your identity.
                </>
              ) : (
                "Tell us about your organization."
              )}
            </h1>
            <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
              {found ? "Here is what Briefly found. Change anything that isn't right — you can refine it later." : "A name is enough to start; everything else can come later."}
            </p>
          </div>

          {found?.colours.length ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              {found.logoUrl ? <RemoteLogo src={found.logoUrl} /> : null}
              <div className="min-w-0 flex-1">
                <p className="label-caps">Your colours</p>
                <div className="mt-1.5 flex gap-1.5">
                  {found.colours.map((c) => (
                    <span key={c} className="size-6 rounded-md border border-black/10" style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">Organization name</Label>
              <Input id="name" name="name" required defaultValue={found?.name ?? ""} placeholder="Acme" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type">Type</Label>
              <NativeSelect id="type" name="type" defaultValue={found?.type ?? "COMPANY"}>
                {TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="locale">Language</Label>
              <NativeSelect id="locale" name="locale" defaultValue={found?.locale ?? "en"}>
                <option value="en">English</option>
                <option value="fr">Français</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="publicationName">What will you publish?</Label>
              <Input id="publicationName" name="publicationName" required defaultValue={found?.name ? `${found.name} Weekly` : ""} placeholder="Acme Weekly" />
              <p className="text-xs text-muted-foreground">A recurring title. Each edition decides for itself whether it goes out by email, on the web, as a magazine or in print.</p>
            </div>
          </div>

          {found && Object.keys(found.links).length > 1 ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="label-caps flex items-center gap-1.5">
                <Link2 className="size-3" /> Where you already post
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
          <input type="hidden" name="description" value={found?.description ?? ""} />
          <input type="hidden" name="logoUrl" value={found?.logoUrl ?? ""} />
          <input type="hidden" name="faviconUrl" value={found?.faviconUrl ?? ""} />
          <input type="hidden" name="colours" value={JSON.stringify(found?.colours ?? [])} />
          <input type="hidden" name="links" value={JSON.stringify(found?.links ?? {})} />
          <input type="hidden" name="timezone" value={suggestedTimezone} />

          {confirmState && !confirmState.ok ? <ErrorNote message={confirmState.error} /> : null}

          <div className={cn("flex items-center gap-3")}>
            <Button type="submit" size="lg" loading={confirming}>
              {confirming ? "Creating your workspace…" : "Looks good — create my workspace"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
