"use client";

import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { BookOpen, Check, Globe, Link2, Mail, Palette, Printer, Sparkles } from "lucide-react";
import { useTranslations } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * The hero demonstration.
 *
 * Somebody landing here has ten seconds to understand the product, and the sentence "we read your
 * website and build your publication" is much less convincing than watching it happen. So this
 * types an address, finds things one at a time, and assembles four outputs.
 *
 * It is a performance, not a live call — a real lookup would take seconds, could fail, and would let
 * the page become a way of probing arbitrary hosts. The claims it makes are ones the product
 * genuinely does at /onboarding, on the fictional brand shown.
 *
 * Nothing moves for somebody who asked for less motion: the finished state is shown immediately.
 */

type Phase = "typing" | "finding" | "building" | "done";

const DOMAIN = "meridian.co";
const FINDINGS = ["demoFound", "demoColours", "demoSocial", "demoBrand"] as const;
const PALETTE = ["#1F3A5F", "#3E7CB1", "#D4AF37", "#EFE6D4"];

/**
 * The media query, as external state.
 *
 * `useSyncExternalStore` rather than an effect: the server has no idea what the visitor prefers, so
 * the snapshot it renders is "motion is fine" and the client corrects it before paint instead of
 * after — no flash of an animation somebody asked not to see.
 */
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  );
}

type State = { phase: Phase; typed: number; found: number };
type Action = { type: "tick" } | { type: "finish" };

function reduce(state: State, action: Action): State {
  if (action.type === "finish") return { phase: "done", typed: DOMAIN.length, found: FINDINGS.length };
  switch (state.phase) {
    case "typing":
      return state.typed < DOMAIN.length ? { ...state, typed: state.typed + 1 } : { ...state, phase: "finding" };
    case "finding":
      return state.found < FINDINGS.length ? { ...state, found: state.found + 1 } : { ...state, phase: "building" };
    case "building":
      return { ...state, phase: "done" };
    default:
      return state;
  }
}

const OUTPUTS = [
  { key: "email", icon: Mail },
  { key: "web", icon: Globe },
  { key: "magazine", icon: BookOpen },
  { key: "print", icon: Printer },
] as const;

export function HeroDemo() {
  const t = useTranslations();
  const reduced = usePrefersReducedMotion();
  const [state, dispatch] = useReducer(reduce, { phase: "typing", typed: 0, found: 0 });
  const started = useRef(false);

  useEffect(() => {
    if (reduced) {
      dispatch({ type: "finish" });
      return;
    }
    if (started.current) return;
    started.current = true;
    // Typing is quick, finding is deliberate: the pauses are where the claims land.
    const delay = () => (state.phase === "typing" ? 55 : 620);
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      dispatch({ type: "tick" });
      timer = setTimeout(step, delay());
    };
    timer = setTimeout(step, 700);
    return () => clearTimeout(timer);
    // The reducer drives itself from here; re-running on every phase change would restack timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const typedText = DOMAIN.slice(0, state.typed);
  const ready = state.phase === "done";

  return (
    <div className="relative mx-auto w-full max-w-[520px]" aria-label={t("marketing.hero.demoReady")}>
      <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,16,20,0.04),0_12px_40px_-12px_rgba(16,16,20,0.16)]">
        <label className="label-caps" htmlFor="hero-demo-domain">
          {t("marketing.hero.demoPrompt")}
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
          <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span id="hero-demo-domain" className="font-mono text-[14px] text-foreground">
            {typedText}
            {state.phase === "typing" && !reduced ? <span className="ml-px inline-block h-[15px] w-px animate-pulse bg-foreground align-middle" /> : null}
          </span>
        </div>

        <ul className="mt-4 space-y-2">
          {FINDINGS.map((finding, index) => {
            const shown = state.found > index;
            return (
              <li
                key={finding}
                className={cn(
                  "flex items-center gap-2.5 text-[13px] transition-all duration-500",
                  shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/10">
                  <Check className="size-3 text-emerald-600" aria-hidden />
                </span>
                <span className="text-muted-foreground">{t(`marketing.hero.${finding}`)}</span>
                {finding === "demoColours" && shown ? (
                  <span className="ml-auto flex gap-1">
                    {PALETTE.map((colour, i) => (
                      <span
                        key={colour}
                        className="size-3.5 rounded-[3px] border border-black/5 transition-all duration-500"
                        style={{ backgroundColor: colour, transitionDelay: `${i * 90}ms` }}
                      />
                    ))}
                  </span>
                ) : null}
                {finding === "demoSocial" && shown ? <Link2 className="ml-auto size-3.5 text-muted-foreground" aria-hidden /> : null}
                {finding === "demoBrand" && shown ? <Palette className="ml-auto size-3.5 text-muted-foreground" aria-hidden /> : null}
              </li>
            );
          })}
        </ul>

        <div
          className={cn(
            "mt-5 border-t border-border pt-4 transition-all duration-700",
            state.phase === "building" || ready ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            <Sparkles className="size-3.5 text-muted-foreground" aria-hidden />
            {t("marketing.hero.demoReady")}
          </p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {OUTPUTS.map(({ key, icon: Icon }, index) => (
              <div
                key={key}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-3 transition-all duration-500",
                  ready ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
                )}
                style={{ transitionDelay: reduced ? undefined : `${index * 110}ms` }}
              >
                <Icon className="size-4 text-foreground" aria-hidden />
                <span className="text-center text-2xs leading-3 text-muted-foreground">{t(`marketing.outputs.${key}` as "marketing.hero.demoReady")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
