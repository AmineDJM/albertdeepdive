"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Laptop, LogOut, Moon, SlidersHorizontal, Sparkles, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FieldError, SettingsCard } from "@/components/settings/key-value";
import { changePasswordAction, setExperienceAction, setThemeAction, signOutOtherSessionsAction, updateProfileAction } from "./actions";
import type { ExperienceMode } from "@/lib/experience";
import { relativeTime, formatDateTime } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

type SessionRow = { id: string; userAgent: string | null; createdAt: Date; lastSeenAt: Date; expiresAt: Date; current: boolean };

function describeAgent(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}

export function IdentityForm({ name, email }: { name: string; email: string }) {
  const tr = useUi();
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [pending, start] = useTransition();
  const dirty = value.trim() !== name;
  return (
    <SettingsCard title={tr("Identity")} description={tr("Your name appears in bylines, comments and the audit log.")}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await updateProfileAction({ name: value });
            if (!res.ok) {
              setErrors(res.fieldErrors ?? null);
              toast.error(res.error);
              return;
            }
            setErrors(null);
            toast.success(res.message);
            router.refresh();
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">{tr("Full name")}</Label>
          <Input id="profile-name" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="name" />
          <FieldError errors={errors} name="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-email">{tr("Email")}</Label>
          <Input id="profile-email" value={email} readOnly disabled />
          <p className="text-2xs text-muted-foreground">{tr("Ask a super admin to change your email.")}</p>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm" loading={pending} disabled={!dirty || value.trim().length < 2}>
            {tr("Save name")}</Button>
        </div>
      </form>
    </SettingsCard>
  );
}

export function PasswordForm() {
  const tr = useUi();
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const ready = form.currentPassword.length > 0 && form.newPassword.length >= 10 && form.newPassword === form.confirmPassword;
  return (
    <SettingsCard title={tr("Password")} description={tr("At least 10 characters. Changing it signs out your other devices.")}>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await changePasswordAction(form);
            if (!res.ok) {
              setErrors(res.fieldErrors ?? null);
              toast.error(res.error);
              return;
            }
            setErrors(null);
            setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
            toast.success(res.message);
            router.refresh();
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">{tr("Current password")}</Label>
          <Input id="pw-current" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set("currentPassword")} />
          <FieldError errors={errors} name="currentPassword" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-new">{tr("New password")}</Label>
          <Input id="pw-new" type="password" autoComplete="new-password" value={form.newPassword} onChange={set("newPassword")} aria-invalid={form.newPassword.length > 0 && form.newPassword.length < 10} />
          <FieldError errors={errors} name="newPassword" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-confirm">{tr("Confirm new password")}</Label>
          <Input id="pw-confirm" type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set("confirmPassword")} aria-invalid={form.confirmPassword.length > 0 && form.confirmPassword !== form.newPassword} />
          <FieldError errors={errors} name="confirmPassword" />
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" size="sm" loading={pending} disabled={!ready}>
            {tr("Change password")}</Button>
        </div>
      </form>
    </SettingsCard>
  );
}

export function ThemeForm({ saved }: { saved: "light" | "dark" }) {
  const tr = useUi();
  const { theme, setTheme } = useTheme();
  const [pending, start] = useTransition();
  // True only after hydration, without writing state from an effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const current = mounted ? (theme === "dark" ? "dark" : "light") : saved;
  function choose(next: "light" | "dark") {
    setTheme(next);
    start(async () => {
      const res = await setThemeAction(next);
      if (!res.ok) toast.error(res.error);
    });
  }
  return (
    <SettingsCard title={tr("Appearance")} description={tr("Applied immediately on this device and remembered with your account.")}>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("Theme")}>
        {(
          [
            { key: "light", label: tr("Light"), icon: Sun },
            { key: "dark", label: tr("Dark"), icon: Moon },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={current === opt.key}
            onClick={() => choose(opt.key)}
            disabled={pending}
            className={`flex h-9 items-center gap-2 rounded-md border px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${current === opt.key ? "border-brand bg-brand-soft/60 font-medium text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
          >
            <opt.icon className="size-4" />
            {opt.label}
          </button>
        ))}
        <span className="inline-flex items-center gap-1.5 self-center text-2xs text-muted-foreground">
          <Laptop className="size-3.5" />{" "}{tr("Saved preference:")}{" "}{saved}
        </span>
      </div>
    </SettingsCard>
  );
}

export function SessionsCard({ sessions }: { sessions: SessionRow[] }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const others = sessions.filter((s) => !s.current).length;
  return (
    <SettingsCard
      title={tr("Sessions")}
      description={tr("Devices currently signed in with your account.")}
      action={
        <Button
          size="sm"
          variant="outline"
          loading={pending}
          disabled={!others}
          onClick={() =>
            start(async () => {
              const res = await signOutOtherSessionsAction();
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success(res.message);
              router.refresh();
            })
          }
        >
          <LogOut />{" "}{tr("Sign out other sessions")}</Button>
      }
    >
      <ul className="divide-y divide-border">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{describeAgent(s.userAgent)}</span>
                {s.current ? <Badge variant="brand">{tr("This device")}</Badge> : null}
              </div>
              <div className="text-2xs text-muted-foreground">
                {tr("Signed in")}{" "}{formatDateTime(s.createdAt)}{" "}{tr("· last seen")}{" "}{relativeTime(s.lastSeenAt)}{" "}{tr("· expires")}{" "}{formatDateTime(s.expiresAt)}
              </div>
            </div>
          </li>
        ))}
        {!sessions.length ? <li className="py-4 text-center text-xs text-muted-foreground">{tr("No active sessions.")}</li> : null}
      </ul>
    </SettingsCard>
  );
}

/**
 * Standard or Advanced.
 *
 * Two cards, one chosen. The choice is the person's and travels with them; it changes what the
 * interface shows and never what the workspace holds, which the description says in so many words
 * because it is the first thing anyone wonders before switching.
 */
export function ExperienceForm({ saved }: { saved: ExperienceMode }) {
  const tr = useUi();
  const router = useRouter();
  const [current, setCurrent] = useState<ExperienceMode>(saved);
  const [pending, start] = useTransition();
  function choose(next: ExperienceMode) {
    if (next === current) return;
    setCurrent(next);
    start(async () => {
      const res = await setExperienceAction(next);
      if (!res.ok) {
        setCurrent(current);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? tr("Saved"));
      router.refresh();
    });
  }
  const options: { key: ExperienceMode; title: string; body: string; icon: typeof Sparkles; tag?: string }[] = [
    { key: "standard", title: tr("Standard"), body: tr("See what Briefly collected, choose what goes in, preview, publish. Briefly decides the rest, and you can change any decision that matters in one click."), icon: Sparkles, tag: tr("Recommended") },
    { key: "advanced", title: tr("Advanced"), body: tr("Every door open: page plans, exports, prompts, automations, the records. For the person who wants to set things by hand."), icon: SlidersHorizontal },
  ];
  return (
    <SettingsCard title={tr("Experience")} description={tr("How much of Briefly you see. Switching changes nothing in your workspace — not an edition, not the brand, not a setting.")}>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={tr("Experience")}>
        {options.map((opt) => {
          const active = current === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(opt.key)}
              disabled={pending}
              data-testid={`experience-${opt.key}`}
              className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${active ? "border-brand bg-brand-soft/50" : "border-border bg-card hover:border-foreground/20"}`}
            >
              <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md ${active ? "bg-brand text-white" : "bg-muted text-muted-foreground"}`}>
                <opt.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  {opt.title}
                  {opt.tag ? <Badge variant="outline">{opt.tag}</Badge> : null}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{opt.body}</span>
              </span>
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
}
