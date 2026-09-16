"use client";

import { EXTRA_FIELDS } from "@/lib/submissions/schemas";
import { STORY_TYPES, type StoryTypeValue } from "@/lib/constants";
import { firstError, SectionTitle, TextAreaField, TextField, UrlListField, type FieldErrors } from "./fields";

const SECTION_TITLES: Partial<Record<StoryTypeValue, { title: string; description: string }>> = {
  BUSINESS_DEEP_DIVE: { title: "The case, step by step", description: "This is what a Business Deep Dive article is built from. Fill what you can — names in full, numbers when you have them." },
  UPCOMING_EVENT: { title: "Save the date", description: "Why, with whom, where and when — and how to sign up." },
  EVENT_RECAP: { title: "About the event", description: "" },
  INTERVIEW_PROFILE: { title: "Who is it about?", description: "" },
  ASSOCIATION: { title: "About the association", description: "" },
  STUDENT_PROJECT: { title: "About the project", description: "" },
  STUDENT_ACHIEVEMENT: { title: "The achievement", description: "" },
  DATA_AI_BUSINESS_INSIGHT: { title: "Sources", description: "The newsroom only publishes insights it can trace back to a source." },
};

export function ExtraFields({
  storyType,
  value,
  onChange,
  onBlur,
  errors,
}: {
  storyType: StoryTypeValue;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onBlur?: () => void;
  errors?: FieldErrors;
}) {
  const specs = EXTRA_FIELDS[storyType] ?? [];
  if (!specs.length) return null;
  const meta = SECTION_TITLES[storyType] ?? { title: `About this ${STORY_TYPES.find((t) => t.value === storyType)?.label.toLowerCase() ?? "story"}`, description: "" };
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  return (
    <section className="space-y-5" aria-labelledby="extra-fields-title">
      <SectionTitle description={meta.description || undefined}>
        <span id="extra-fields-title">{meta.title}</span>
      </SectionTitle>
      {specs.map((spec) => {
        const key = `extra.${spec.key}`;
        const error = firstError(errors, key);
        const raw = value[spec.key];
        if (spec.kind === "urls") {
          const list = Array.isArray(raw) ? raw.map(String) : [];
          return (
            <UrlListField
              key={spec.key}
              label={spec.label}
              values={list}
              onChange={(next) => set(spec.key, next)}
              onBlur={onBlur}
              hint={spec.help}
              error={error}
              errors={errors}
              errorPrefix={key}
              required={spec.required}
              optional={!spec.required}
            />
          );
        }
        const text = typeof raw === "string" ? raw : "";
        if (spec.kind === "textarea") {
          return (
            <TextAreaField key={spec.key} label={spec.label} value={text} onChange={(v) => set(spec.key, v)} onBlur={onBlur} placeholder={spec.placeholder} hint={spec.help} error={error} required={spec.required} optional={!spec.required} rows={3} />
          );
        }
        return (
          <TextField
            key={spec.key}
            label={spec.label}
            value={text}
            onChange={(v) => set(spec.key, v)}
            onBlur={onBlur}
            placeholder={spec.placeholder}
            hint={spec.help}
            error={error}
            required={spec.required}
            optional={!spec.required}
            type={spec.kind === "url" ? "url" : "text"}
            inputMode={spec.kind === "url" ? "url" : "text"}
          />
        );
      })}
    </section>
  );
}
