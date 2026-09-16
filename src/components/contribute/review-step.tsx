"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { CONSENT_TEXTS, storyTypeLabel } from "@/lib/constants";
import type { AttachmentDTO, CampusDTO } from "@/lib/submissions/dto";
import { EXTRA_FIELDS } from "@/lib/submissions/schemas";
import { cn, truncate } from "@/lib/utils";
import { firstError, SectionTitle, type FieldErrors } from "./fields";
import type { FormValues } from "./form-state";

export function ReviewStep({
  values,
  campuses,
  attachments,
  errors,
  consentTextVersion,
  onEdit,
  onChange,
}: {
  values: FormValues;
  campuses: CampusDTO[];
  attachments: AttachmentDTO[];
  errors: FieldErrors;
  consentTextVersion: string;
  onEdit: (step: 0 | 1 | 2) => void;
  onChange: (patch: Partial<FormValues>) => void;
}) {
  const campusNames = values.campusIds.length ? values.campusIds.map((id) => campuses.find((c) => c.id === id)?.name ?? "?").join(", ") : "Whole school";
  const photos = attachments.filter((a) => a.kind === "IMAGE").length;
  const others = attachments.length - photos;
  const extraSpecs = values.storyType ? EXTRA_FIELDS[values.storyType] : [];
  const extraLines = extraSpecs
    .map((spec) => {
      const v = values.extra[spec.key];
      const text = Array.isArray(v) ? v.filter(Boolean).join(", ") : typeof v === "string" ? v : "";
      return text ? { label: spec.label, text } : null;
    })
    .filter((x): x is { label: string; text: string } => !!x);
  const consentError = firstError(errors, "publicationConsent");
  const rightsError = firstError(errors, "imageRightsConfirmed");

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="review-title">
        <SectionTitle description="A quick look before it goes to the newsroom.">
          <span id="review-title">Review your story</span>
        </SectionTitle>
        <dl className="divide-y divide-border rounded-xl border border-border bg-card">
          <Row label="Story type" onEdit={() => onEdit(0)}>
            {values.storyType ? storyTypeLabel(values.storyType) : <Missing />}
          </Row>
          <Row label="Title" onEdit={() => onEdit(1)}>
            {values.title.trim() ? values.title : <Missing />}
          </Row>
          <Row label="Campus" onEdit={() => onEdit(1)}>
            {campusNames}
          </Row>
          {values.eventDateText.trim() ? (
            <Row label="When" onEdit={() => onEdit(1)}>
              {values.eventDateText}
            </Row>
          ) : null}
          <Row label="What happened" onEdit={() => onEdit(1)}>
            {values.description.trim() ? <span className="whitespace-pre-line">{truncate(values.description.trim(), 360)}</span> : <Missing />}
          </Row>
          {extraLines.map((line) => (
            <Row key={line.label} label={line.label} onEdit={() => onEdit(1)}>
              <span className="whitespace-pre-line">{truncate(line.text, 200)}</span>
            </Row>
          ))}
          {values.peopleInvolved.trim() ? (
            <Row label="People" onEdit={() => onEdit(1)}>
              {values.peopleInvolved}
            </Row>
          ) : null}
          <Row label="Photos & files" onEdit={() => onEdit(2)}>
            {attachments.length ? `${photos} ${photos === 1 ? "photo" : "photos"}${others ? `, ${others} ${others === 1 ? "file" : "files"}` : ""}` : <span className="text-muted-foreground">None — that&rsquo;s fine</span>}
          </Row>
        </dl>
      </section>

      <section className="space-y-4" aria-labelledby="consent-title">
        <SectionTitle description={`Two quick confirmations (consent text ${consentTextVersion}).`}>
          <span id="consent-title">Before we publish</span>
        </SectionTitle>
        <ConsentCheckbox id="consent-publication" checked={values.publicationConsent} onChange={(v) => onChange({ publicationConsent: v })} text={CONSENT_TEXTS.PUBLICATION} error={consentError} required />
        {photos > 0 ? (
          <ConsentCheckbox id="consent-image-rights" checked={values.imageRightsConfirmed} onChange={(v) => onChange({ imageRightsConfirmed: v })} text={CONSENT_TEXTS.IMAGE_RIGHTS} error={rightsError} required />
        ) : null}
      </section>
    </div>
  );
}

function Row({ label, children, onEdit }: { label: string; children: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <dt className="w-28 shrink-0 pt-0.5 text-[13px] font-medium text-muted-foreground sm:w-36">{label}</dt>
      <dd className="min-w-0 flex-1 text-[15px] leading-6 break-words">{children}</dd>
      <button type="button" onClick={onEdit} className="focus-ring -my-2 -mr-2 h-9 shrink-0 rounded-md px-2 text-[13px] font-medium text-brand-foreground hover:bg-brand-soft">
        Edit
      </button>
    </div>
  );
}

function Missing() {
  return <span className="text-destructive">Missing</span>;
}

function ConsentCheckbox({ id, checked, onChange, text, error, required }: { id: string; checked: boolean; onChange: (v: boolean) => void; text: string; error?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors", error ? "border-destructive/60 bg-destructive/5" : checked ? "border-primary/50 bg-brand-soft/50" : "border-border bg-card hover:border-primary/40")}>
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-invalid={!!error || undefined} aria-required={required} className="mt-1 size-5 [&_svg]:size-3.5" />
        <span className="text-[15px] leading-6">{text}</span>
      </label>
      {error ? (
        <p className="text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
