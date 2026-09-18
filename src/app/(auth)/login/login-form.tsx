"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { signInAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { useUi } from "@/components/i18n/provider";

export function LoginForm({ next, demo }: { next?: string; demo?: { email: string; password: string } | null }) {
  const tr = useUi();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(signInAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">{tr("Email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={demo?.email ?? ""} aria-invalid={!!fieldErrors?.email} placeholder={tr("you@example.com")} />
        {fieldErrors?.email ? <p className="text-xs text-destructive">{fieldErrors.email[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{tr("Password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required defaultValue={demo?.password ?? ""} aria-invalid={!!fieldErrors?.password} />
        {fieldErrors?.password ? <p className="text-xs text-destructive">{fieldErrors.password[0]}</p> : null}
      </div>
      {state && !state.ok && !state.fieldErrors ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        {tr("Sign in to the newsroom")}</Button>
    </form>
  );
}
