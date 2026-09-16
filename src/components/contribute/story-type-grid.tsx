"use client";

import { useRef, type KeyboardEvent } from "react";
import { STORY_TYPES, type StoryTypeValue } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** The 16 story types as tappable cards behaving like a radio group. */
export function StoryTypeGrid({ value, onChange, error }: { value: StoryTypeValue | null; onChange: (value: StoryTypeValue) => void; error?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const delta = keys[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + STORY_TYPES.length) % STORY_TYPES.length;
    refs.current[next]?.focus();
    onChange(STORY_TYPES[next].value);
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Story type" aria-invalid={error ? true : undefined} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {STORY_TYPES.map((type, index) => {
          const selected = value === type.value;
          return (
            <button
              key={type.value}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (value === null && index === 0) ? 0 : -1}
              onClick={() => onChange(type.value)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "focus-ring flex min-h-[88px] flex-col items-start gap-1 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow]",
                selected ? "border-brand bg-brand-soft shadow-[inset_0_0_0_1px_var(--brand)]" : "border-border bg-card hover:border-brand/60 hover:bg-brand-soft/40",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[15px] leading-5 font-semibold text-foreground">{type.label}</span>
                <span
                  aria-hidden
                  className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary bg-primary" : "border-border bg-card")}
                >
                  {selected ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
                </span>
              </span>
              <span className="text-[13px] leading-[18px] text-muted-foreground">{type.description}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="mt-2 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
