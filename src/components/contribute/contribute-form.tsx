"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { STORY_TYPES } from "@/lib/constants";
import type { AttachmentDTO, InvitationDTO } from "@/lib/submissions/dto";
import { validateSubmissionPayload } from "@/lib/submissions/schemas";
import { cn } from "@/lib/utils";
import { contributeApi, ContributeApiError } from "./api";
import { CampusChips } from "./campus-chips";
import { ContributeHeader, type SaveStatus } from "./contribute-header";
import { ExtraFields } from "./extra-fields";
import { SectionTitle, TextAreaField, TextField, UrlListField, type FieldErrors } from "./fields";
import { DETAILS_ONLY_ERRORS, diffValues, payloadFromValues, STEPS, stepForError, valuesFromDraft, type FormValues, type Step } from "./form-state";
import { ReviewStep } from "./review-step";
import { ContactLine, PublicShell, StatusScreen } from "./state-screens";
import { StoryTypeGrid } from "./story-type-grid";
import { SuccessScreen } from "./success-screen";
import { UploadZone, type UploadLimits } from "./upload-zone";

export type ContributeFormProps = { token: string; invitation: InvitationDTO; limits: UploadLimits };

const AUTOSAVE_DEBOUNCE_MS = 2500;
const BLUR_DEBOUNCE_MS = 500;
const RETRY_MS = 6000;

function descriptionGuidance(words: number) {
  if (words === 0) return "What happened, who was there, when and where. Names in full, numbers when you have them.";
  if (words < 40) return "Good start — a few more details help the editors (names, dates, results).";
  if (words < 400) return "Great — that is a solid base for an article.";
  return "Long and thorough — the editors will trim if needed.";
}

export function ContributeForm({ token, invitation: initialInvitation, limits }: ContributeFormProps) {
  const [invitation, setInvitation] = useState(initialInvitation);
  const [values, setValues] = useState<FormValues>(() => valuesFromDraft(initialInvitation.draft, initialInvitation));
  const [attachments, setAttachments] = useState<AttachmentDTO[]>(initialInvitation.draft?.attachments ?? []);
  const [step, setStep] = useState<Step>(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: initialInvitation.draft ? "saved" : "idle" });
  const [retryTick, setRetryTick] = useState(0);

  // ── Autosave plumbing (refs so callbacks never go stale) ─────────────────
  const draftIdRef = useRef<string | null>(initialInvitation.draft?.id ?? null);
  const creatingRef = useRef<Promise<string> | null>(null);
  const valuesRef = useRef(values);
  const lastSavedRef = useRef<FormValues>(values);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);

  const ensureDraft = useCallback(async () => {
    if (draftIdRef.current) return draftIdRef.current;
    if (!creatingRef.current) {
      creatingRef.current = contributeApi
        .createDraft(token)
        .then((r) => {
          draftIdRef.current = r.draft.id;
          return r.draft.id;
        })
        .finally(() => {
          creatingRef.current = null;
        });
    }
    return creatingRef.current;
  }, [token]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = diffValues(lastSavedRef.current, valuesRef.current);
    if (!Object.keys(patch).length) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaveStatus((s) => ({ ...s, status: "saving" }));
    const snapshot = valuesRef.current;
    try {
      const id = await ensureDraft();
      await contributeApi.saveDraft(token, id, patch);
      lastSavedRef.current = { ...lastSavedRef.current, ...Object.fromEntries(Object.keys(patch).map((k) => [k, snapshot[k as keyof FormValues]])) };
      setSaveStatus({ status: "saved", at: new Date() });
    } catch {
      setSaveStatus({ status: "error" });
      timerRef.current = window.setTimeout(() => setRetryTick((n) => n + 1), RETRY_MS);
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        setRetryTick((n) => n + 1);
      }
    }
  }, [ensureDraft, token]);

  // Retries (after a failed save) and follow-up saves (changes made while saving) re-enter flush here.
  useEffect(() => {
    if (retryTick === 0) return;
    const id = window.setTimeout(() => void flush(), 0);
    return () => window.clearTimeout(id);
  }, [retryTick, flush]);

  const scheduleFlush = useCallback(
    (delay: number) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  // Debounced autosave while typing; blur and step changes flush sooner.
  useEffect(() => {
    if (!Object.keys(diffValues(lastSavedRef.current, values)).length) return;
    scheduleFlush(AUTOSAVE_DEBOUNCE_MS);
  }, [values, scheduleFlush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  const update = useCallback((patch: Partial<FormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    if (Object.keys(patch).length) {
      setErrors((current) => {
        const next = { ...current };
        for (const key of Object.keys(patch)) {
          delete next[key];
          if (key === "extra") for (const k of Object.keys(next)) if (k.startsWith("extra.")) delete next[k];
          if (key === "urls") for (const k of Object.keys(next)) if (k.startsWith("urls.")) delete next[k];
        }
        return next;
      });
    }
  }, []);

  const onBlur = useCallback(() => scheduleFlush(BLUR_DEBOUNCE_MS), [scheduleFlush]);

  const hasPhotos = attachments.some((a) => a.kind === "IMAGE");

  const focusFirstInvalid = () => {
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus({ preventScroll: true });
      } else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 50);
  };

  const goTo = (next: Step) => {
    void flush();
    setStep(next);
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const continueFrom = (current: Step) => {
    if (current === 0) {
      if (!values.storyType) {
        setErrors({ storyType: ["Pick the kind of story you want to tell"] });
        return;
      }
      goTo(1);
      return;
    }
    if (current === 1) {
      const result = validateSubmissionPayload({ ...payloadFromValues(values), publicationConsent: true, imageRightsConfirmed: true }, { hasPhotos: false });
      const detailErrors = result.ok ? {} : DETAILS_ONLY_ERRORS(result.fieldErrors);
      if (Object.keys(detailErrors).length) {
        setErrors(detailErrors);
        setFormError(Object.keys(detailErrors).length === 1 ? "One field needs your attention." : `${Object.keys(detailErrors).length} fields need your attention.`);
        focusFirstInvalid();
        return;
      }
      goTo(2);
      return;
    }
    if (current === 2) goTo(3);
  };

  const submit = async () => {
    setFormError(null);
    const payload = payloadFromValues(values);
    const result = validateSubmissionPayload(payload, { hasPhotos });
    if (!result.ok) {
      setErrors(result.fieldErrors);
      const firstStep = Math.min(...Object.keys(result.fieldErrors).map(stepForError)) as Step;
      if (firstStep !== step) setStep(firstStep);
      setFormError(result.error);
      focusFirstInvalid();
      return;
    }
    setSubmitting(true);
    try {
      await flush();
      const id = await ensureDraft();
      await contributeApi.submit(token, id, payload);
      setSubmitted(true);
      setInvitation((inv) => ({ ...inv, submittedCount: inv.submittedCount + 1, status: "SUBMITTED" }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (err instanceof ContributeApiError && err.fieldErrors) {
        setErrors(err.fieldErrors);
        const firstStep = Math.min(...Object.keys(err.fieldErrors).map(stepForError)) as Step;
        setStep(firstStep);
        setFormError(err.message);
        focusFirstInvalid();
      } else {
        setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startAnother = async () => {
    setBusy(true);
    try {
      const { draft } = await contributeApi.createDraft(token, true);
      draftIdRef.current = draft.id;
      const fresh = valuesFromDraft(draft, invitation);
      lastSavedRef.current = fresh;
      setValues(fresh);
      setAttachments([]);
      setErrors({});
      setFormError(null);
      setSubmitted(false);
      setStep(0);
      setSaveStatus({ status: "idle" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not start a new story.");
    } finally {
      setBusy(false);
    }
  };

  const decline = async (undo: boolean) => {
    setBusy(true);
    try {
      const result = await contributeApi.decline(token, undo ? { undo: true } : {});
      setInvitation((inv) => ({
        ...inv,
        status: result.status as InvitationDTO["status"],
        canSubmit: undo ? true : false,
        blockedReason: undo ? null : "DECLINED",
      }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const selectedType = useMemo(() => STORY_TYPES.find((t) => t.value === values.storyType) ?? null, [values.storyType]);

  // ── Blocked states ────────────────────────────────────────────────────────
  if (!invitation.canSubmit) {
    return (
      <PublicShell editionLabel={invitation.edition.label}>
        <BlockedScreen invitation={invitation} onUndoDecline={() => decline(true)} busy={busy} />
      </PublicShell>
    );
  }

  if (submitted) {
    return (
      <PublicShell editionLabel={invitation.edition.label}>
        <SuccessScreen firstName={invitation.contributor.firstName} editionLabel={invitation.edition.label} submittedCount={invitation.submittedCount} closesLabel={invitation.labels.graceEnds} onAnother={startAnother} busy={busy} />
        {formError ? (
          <p className="mt-4 text-[13px] text-destructive" role="alert">
            {formError}
          </p>
        ) : null}
      </PublicShell>
    );
  }

  const isLast = step === 3;

  return (
    <PublicShell editionLabel={invitation.edition.label}>
      <ContributeHeader
        firstName={invitation.contributor.firstName}
        campusName={invitation.contributor.campusName}
        deadlineLabel={invitation.labels.deadline}
        introMessage={invitation.campaign.introMessage}
        saveStatus={saveStatus}
        compact={step !== 0}
      />

      <Stepper current={step} onSelect={(s) => s < step && goTo(s)} />

      <form
        className="mt-5 space-y-8 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (isLast) void submit();
          else continueFrom(step);
        }}
        onBlur={onBlur}
        noValidate
      >
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{formError}</AlertTitle>
            <AlertDescription>Fields that need a change are highlighted below.</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant="warning">
            <AlertCircle />
            <AlertTitle>{notice}</AlertTitle>
          </Alert>
        ) : null}

        {step === 0 ? (
          <div className="space-y-5">
            <SectionTitle description="Pick the closest match — the editors can always change it.">What happened?</SectionTitle>
            <StoryTypeGrid
              value={values.storyType}
              onChange={(storyType) => {
                update({ storyType });
                setErrors({});
              }}
              error={errors.storyType?.[0]}
            />
          </div>
        ) : null}

        {step === 1 && values.storyType ? (
          <div className="space-y-8">
            <div className="space-y-5">
              <SectionTitle description={selectedType ? `${selectedType.label} · ${selectedType.description}` : undefined}>Tell us more</SectionTitle>
              <TextField label="Title" value={values.title} onChange={(title) => update({ title })} placeholder="A working title — e.g. Carrefour – B2 Paris" error={errors.title?.[0]} required autoComplete="off" maxLength={200} />
              <CampusChips campuses={invitation.campuses} value={values.campusIds} onChange={(campusIds) => update({ campusIds })} error={errors.campusIds?.[0]} />
              <TextField label="When did it happen?" value={values.eventDateText} onChange={(eventDateText) => update({ eventDateText })} placeholder="e.g. from 17 March to 4 April, or Friday 4 April" hint="Dates are precise in the paper — write them as you would say them." error={errors.eventDateText?.[0]} optional maxLength={160} />
              <TextAreaField
                label="What happened?"
                value={values.description}
                onChange={(description) => update({ description })}
                placeholder="Tell it like you would to a friend from another campus."
                error={errors.description?.[0]}
                required
                rows={6}
                showWordCount
                guidance={descriptionGuidance}
              />
            </div>

            <ExtraFields storyType={values.storyType} value={values.extra} onChange={(extra) => update({ extra })} errors={errors} />

            <div className="space-y-5">
              <SectionTitle description="The newsroom names people in full and credits everyone.">Who and why</SectionTitle>
              <TextAreaField label="People involved" value={values.peopleInvolved} onChange={(peopleInvolved) => update({ peopleInvolved })} placeholder="Full names and roles — e.g. Maelle Lalanne Carillon (B1 Marseille), jury: …" error={errors.peopleInvolved?.[0]} optional rows={3} />
              <TextAreaField label="Organisations involved" value={values.organisationsInvolved} onChange={(organisationsInvolved) => update({ organisationsInvolved })} placeholder="Companies, associations, partner schools, sponsors" error={errors.organisationsInvolved?.[0]} optional rows={2} />
              <TextAreaField label="Why does it matter?" value={values.whyItMatters} onChange={(whyItMatters) => update({ whyItMatters })} placeholder="What should other students, staff or partners take away?" error={errors.whyItMatters?.[0]} optional rows={3} />
              <TextAreaField label="A quote or two" value={values.quotes} onChange={(quotes) => update({ quotes })} placeholder={'"…" — Name, role'} hint="A first-person sentence from someone involved makes a great pull quote." error={errors.quotes?.[0]} optional rows={3} />
              <UrlListField label="Links" values={values.urls} onChange={(urls) => update({ urls })} hint="Sign-up pages, articles, Instagram posts, dashboards…" error={errors.urls?.[0]} errors={errors} errorPrefix="urls" optional max={10} />
            </div>

            <div className="space-y-5">
              <SectionTitle description="In case an editor needs a detail. Never published.">How can we reach you?</SectionTitle>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField label="Your name" value={values.contactName} onChange={(contactName) => update({ contactName })} autoComplete="name" error={errors.contactName?.[0]} maxLength={160} />
                <TextField label="Email" type="email" inputMode="email" value={values.contactEmail} onChange={(contactEmail) => update({ contactEmail })} autoComplete="email" error={errors.contactEmail?.[0]} maxLength={200} />
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <UploadZone token={token} ensureDraft={ensureDraft} attachments={attachments} onAttachmentsChange={setAttachments} limits={limits} onError={(message) => setNotice(message)} />
        ) : null}

        {step === 3 ? (
          <ReviewStep values={values} campuses={invitation.campuses} attachments={attachments} errors={errors} consentTextVersion={invitation.consentTextVersion} onEdit={goTo} onChange={update} />
        ) : null}

        <ActionBar
          step={step}
          isLast={isLast}
          submitting={submitting}
          onBack={() => goTo((step - 1) as Step)}
          continueLabel={step === 0 ? "Continue" : step === 1 ? "Continue to photos" : step === 2 ? (attachments.length ? "Continue to review" : "Skip — no files") : "Send my story"}
        />
      </form>

      <footer className="mt-8 space-y-2 text-center text-[13px] text-muted-foreground">
        <p>
          Contributions close {invitation.labels.graceEndsLong} (Paris time). Your draft is saved on this link — come back any time.
        </p>
        <ContactLine email={invitation.contactEmail} />
        {invitation.status !== "SUBMITTED" && invitation.submittedCount === 0 ? (
          <p>
            Nothing to share this month?{" "}
            <button type="button" onClick={() => decline(false)} disabled={busy} className="font-medium text-primary underline underline-offset-4">
              Let the newsroom know
            </button>
            .
          </p>
        ) : null}
      </footer>
    </PublicShell>
  );
}

function Stepper({ current, onSelect }: { current: Step; onSelect: (step: Step) => void }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {STEPS.map((s) => {
        const state = s.key === current ? "current" : s.key < current ? "done" : "todo";
        return (
          <li key={s.key} className="flex flex-1 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onSelect(s.key)}
              disabled={state !== "done"}
              aria-current={state === "current" ? "step" : undefined}
              className={cn("focus-ring h-1.5 w-full rounded-full transition-colors", state === "current" ? "bg-brand" : state === "done" ? "bg-primary" : "bg-border")}
              aria-label={`Step ${s.key + 1}: ${s.label}`}
            />
            <span className={cn("truncate text-[11px] font-medium tracking-wide uppercase", state === "todo" ? "text-muted-foreground/70" : "text-foreground")}>
              <span className="hidden sm:inline">{s.label}</span>
              <span className="sm:hidden">{s.short}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ActionBar({ step, isLast, submitting, onBack, continueLabel }: { step: Step; isLast: boolean; submitting: boolean; onBack: () => void; continueLabel: string }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:backdrop-blur-none">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3 sm:px-0 sm:py-0">
        {step > 0 ? (
          <Button type="button" variant="outline" size="lg" className="h-11 px-4 text-[15px]" onClick={onBack} disabled={submitting}>
            <ArrowLeft /> Back
          </Button>
        ) : null}
        <Button type="submit" variant={isLast ? "brand" : "default"} size="lg" className="h-11 flex-1 px-5 text-[15px] sm:flex-none" loading={submitting}>
          {continueLabel}
          {isLast ? <Send /> : <ArrowRight />}
        </Button>
      </div>
    </div>
  );
}

function BlockedScreen({ invitation, onUndoDecline, busy }: { invitation: InvitationDTO; onUndoDecline: () => void; busy: boolean }) {
  const { edition, contributor, contactEmail, labels } = invitation;
  switch (invitation.blockedReason) {
    case "DECLINED":
      return (
        <StatusScreen kicker="Thanks for letting us know" title={`See you next month, ${contributor.firstName}`}>
          <p>We will not send you further reminders for the {edition.label} issue.</p>
          <p>
            Changed your mind?{" "}
            <button type="button" onClick={onUndoDecline} disabled={busy} className="font-medium text-primary underline underline-offset-4">
              Reopen your contribution form
            </button>
            .
          </p>
          <ContactLine email={contactEmail} />
        </StatusScreen>
      );
    case "EXPIRED":
      return (
        <StatusScreen kicker={`Albert's Deep Dive · ${edition.label}`} title="This link has expired">
          <p>Personal links stop working a week after the issue closes. If you still have a story for the newsroom, just ask for a new link.</p>
          <ContactLine email={contactEmail} />
        </StatusScreen>
      );
    case "NOT_OPEN":
      return (
        <StatusScreen kicker={`Albert's Deep Dive · ${edition.label}`} title={`Contributions open ${labels.opensLong}`}>
          <p>Hi {contributor.firstName} — you are on the list for the {edition.label} issue. Come back once the campaign opens; this link will be waiting.</p>
          <ContactLine email={contactEmail} />
        </StatusScreen>
      );
    case "CLOSED":
    default:
      return (
        <StatusScreen kicker={`Albert's Deep Dive · ${edition.label}`} title={`Contributions for ${edition.label} are closed`}>
          <p>
            Thanks for stopping by, {contributor.firstName}. The newsroom closed on {labels.graceEndsLong} and the editors are now working on the issue.
            {invitation.submittedCount ? ` Your ${invitation.submittedCount === 1 ? "story is" : `${invitation.submittedCount} stories are`} in.` : ""}
          </p>
          <p>Have something urgent? Email the newsroom — a late brief can sometimes squeeze in.</p>
          <ContactLine email={contactEmail} />
        </StatusScreen>
      );
  }
}
