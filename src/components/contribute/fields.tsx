"use client";

import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, wordCount } from "@/lib/utils";

export type FieldErrors = Record<string, string[]>;

export function firstError(errors: FieldErrors | undefined, key: string) {
  return errors?.[key]?.[0];
}

export function Field({
  label,
  hint,
  error,
  required,
  optional,
  children,
  id,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optional?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  id?: string;
  className?: string;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={fieldId} className="flex items-baseline gap-2 text-[15px] font-medium text-foreground">
        <span>{label}</span>
        {required ? <span className="text-xs font-normal text-destructive">required</span> : optional ? <span className="text-xs font-normal text-muted-foreground">optional</span> : null}
      </label>
      {children({ id: fieldId, describedBy, invalid: !!error })}
      {error ? (
        <p id={errorId} className="text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlClass = "h-11 px-3 text-[15px] rounded-lg bg-card";

export function TextField(props: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optional?: boolean;
  type?: "text" | "email" | "url";
  autoComplete?: string;
  inputMode?: "text" | "email" | "url";
  maxLength?: number;
}) {
  return (
    <Field label={props.label} hint={props.hint} error={props.error} required={props.required} optional={props.optional}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type={props.type ?? "text"}
          inputMode={props.inputMode}
          autoComplete={props.autoComplete}
          value={props.value}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={props.onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={controlClass}
        />
      )}
    </Field>
  );
}

export function TextAreaField(props: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optional?: boolean;
  rows?: number;
  showWordCount?: boolean;
  guidance?: (words: number) => string | null;
  maxLength?: number;
}) {
  const words = wordCount(props.value);
  const guidance = props.showWordCount ? (props.guidance?.(words) ?? null) : null;
  return (
    <Field
      label={props.label}
      error={props.error}
      required={props.required}
      optional={props.optional}
      hint={
        props.showWordCount ? (
          <span className="flex items-center justify-between gap-3">
            <span>{guidance ?? props.hint}</span>
            <span className="tabular shrink-0 text-muted-foreground/80">
              {words} {words === 1 ? "word" : "words"}
            </span>
          </span>
        ) : (
          props.hint
        )
      }
    >
      {({ id, describedBy, invalid }) => (
        <Textarea
          id={id}
          value={props.value}
          rows={props.rows ?? 4}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={props.onBlur}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="min-h-24 rounded-lg bg-card px-3 py-2.5 text-[15px] leading-6"
        />
      )}
    </Field>
  );
}

/** A growing list of links: one input per line, plus an "Add another" affordance. */
export function UrlListField(props: {
  label: ReactNode;
  values: string[];
  onChange: (values: string[]) => void;
  onBlur?: () => void;
  hint?: ReactNode;
  error?: string;
  errors?: FieldErrors;
  errorPrefix?: string;
  required?: boolean;
  optional?: boolean;
  max?: number;
  placeholder?: string;
}) {
  const values = props.values.length ? props.values : [""];
  const max = props.max ?? 10;
  const update = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    props.onChange(next);
  };
  const remove = (index: number) => {
    const next = values.filter((_, i) => i !== index);
    props.onChange(next.length ? next : [""]);
  };
  return (
    <Field label={props.label} hint={props.hint} error={props.error} required={props.required} optional={props.optional}>
      {({ id, describedBy, invalid }) => (
        <div className="space-y-2">
          {values.map((value, index) => {
            const itemError = props.errors && props.errorPrefix ? firstError(props.errors, `${props.errorPrefix}.${index}`) : undefined;
            return (
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    id={index === 0 ? id : `${id}-${index}`}
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    value={value}
                    placeholder={props.placeholder ?? "https://"}
                    onChange={(e) => update(index, e.target.value)}
                    onBlur={props.onBlur}
                    aria-label={index === 0 ? undefined : `Link ${index + 1}`}
                    aria-invalid={invalid || !!itemError || undefined}
                    aria-describedby={index === 0 ? describedBy : undefined}
                    className={controlClass}
                  />
                  {values.length > 1 || value ? (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="focus-ring flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Remove link ${index + 1}`}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                {itemError ? (
                  <p className="text-[13px] text-destructive" role="alert">
                    {itemError}
                  </p>
                ) : null}
              </div>
            );
          })}
          {values.length < max ? (
            <button type="button" onClick={() => props.onChange([...values, ""])} className="focus-ring inline-flex h-9 items-center rounded-lg px-2 text-[14px] font-medium text-brand-foreground hover:bg-brand-soft">
              + Add another link
            </button>
          ) : null}
        </div>
      )}
    </Field>
  );
}

export function SectionTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h2 className="font-display text-[22px] leading-tight font-semibold tracking-tight text-primary">{children}</h2>
      {description ? <p className="text-[14px] text-muted-foreground">{description}</p> : null}
    </div>
  );
}
