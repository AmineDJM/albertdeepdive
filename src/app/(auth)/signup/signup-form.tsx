"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { signUpAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { useUi } from "@/components/i18n/provider";

export function SignupForm({ next }: { next?: string }) {
  const tr = useUi();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(signUpAction, null);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="name">{tr("Your name")}</Label>
        <Input id="name" name="name" autoComplete="name" required aria-invalid={!!fieldErrors?.name} placeholder={tr("Alex Martin")} />
        {fieldErrors?.name ? <p className="text-xs text-destructive">{fieldErrors.name[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">{tr("Work email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!fieldErrors?.email} placeholder={tr("you@example.com")} />
        {fieldErrors?.email ? <p className="text-xs text-destructive">{fieldErrors.email[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{tr("Password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} aria-invalid={!!fieldErrors?.password} />
        <p className="text-2xs text-muted-foreground">{tr("At least 10 characters.")}</p>
        {fieldErrors?.password ? <p className="text-xs text-destructive">{fieldErrors.password[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">{tr("Password again")}</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={!!fieldErrors?.confirm} />
        {fieldErrors?.confirm ? <p className="text-xs text-destructive">{fieldErrors.confirm[0]}</p> : null}
      </div>
      {state && !state.ok && !state.fieldErrors ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}
      <Button type="submit" className="w-full" size="lg" loading={pending} data-testid="signup-submit">
        {tr("Create my account")}</Button>
      <p className="text-center text-2xs text-muted-foreground">{tr("No card. You name your organization next.")}</p>
    </form>
  );
}
