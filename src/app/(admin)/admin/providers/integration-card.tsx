"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, ExternalLink, Lock, Plug, Unplug, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { clearIntegrationAction, saveIntegrationAction, setUpIntegrationAction, testIntegrationAction } from "./actions";
import type { SetupResult } from "@/server/integrations/setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { IntegrationStatus } from "@/server/integrations/service";
import { useUi } from "@/components/i18n/provider";

/**
 * One service, one card.
 *
 * A secret is never sent back to the browser — the field shows a mask and, when the person starts
 * typing, becomes a normal empty input. Leaving it untouched keeps the stored value, which is why
 * saving an unrelated field cannot wipe a working key.
 *
 * A field injected through the environment is shown locked rather than editable: a self-hosted
 * install that sets secrets at deploy time should see that, not silently have them ignored.
 */
export function IntegrationCard({ integration, setupLabel }: { integration: IntegrationStatus; setupLabel?: string }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const dirty = Object.keys(edits).length > 0;

  function runSetup() {
    setSetup(null);
    setTestResult(null);
    startTransition(async () => {
      const result = await setUpIntegrationAction(integration.key);
      if (!result.ok) {
        setSetup({ ok: false, summary: result.error, steps: [] });
        return;
      }
      setSetup(result.data);
      if (result.data.ok) toast.success(result.data.summary);
      router.refresh();
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveIntegrationAction(integration.key, edits);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${integration.name} saved`);
      setEdits({});
      setTestResult(null);
      router.refresh();
    });
  }

  function test() {
    setTestResult(null);
    startTransition(async () => {
      const result = await testIntegrationAction(integration.key);
      if (!result.ok) {
        setTestResult({ ok: false, message: result.error });
        return;
      }
      setTestResult(result.data);
    });
  }

  function disconnect() {
    startTransition(async () => {
      const result = await clearIntegrationAction(integration.key);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${integration.name} disconnected`);
      setEdits({});
      setTestResult(null);
      router.refresh();
    });
  }

  // A tuning card is never "not connected": it works on its defaults and always acts.
  const tuning = integration.kind === "tuning";
  const ready = integration.configured || tuning;
  return (
    <section className={cn("rounded-lg border bg-card p-4", ready ? "border-border" : "border-dashed border-border")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold">
            {integration.name}
            {tuning ? (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">{integration.configured ? tr("Tuned by hand") : tr("Default settings")}</span>
            ) : integration.configured ? (
              <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-600/10 px-1.5 py-0.5 text-2xs font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="size-2.5" />{" "}{tr("Connected")}</span>
            ) : (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">{tr("Not connected")}</span>
            )}
          </h3>
          <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">{integration.summary}</p>
          {!integration.configured ? (
            <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">
              {tuning ? tr("In use now:") : tr("Without it:")}{" "}{integration.whenMissing}
            </p>
          ) : null}
        </div>
        {integration.docsUrl ? (
          <a href={integration.docsUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
            {integration.docsLabel ?? "Where to find the keys"} <ExternalLink className="size-3" />
          </a>
        ) : null}
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {integration.fields.map((field) => {
          const locked = field.source === "env";
          const id = `${integration.key}-${field.key}`;
          const touched = field.key in edits;
          return (
            <div key={field.key} className={cn("space-y-1.5", field.kind === "url" && "sm:col-span-2")}>
              <Label htmlFor={id} className="flex items-center gap-1.5">
                {field.label}
                {field.required ? <span className="text-destructive">*</span> : null}
                {locked ? (
                  <span className="inline-flex items-center gap-1 text-2xs font-normal text-muted-foreground">
                    <Lock className="size-2.5" />{" "}{tr("set by")}{" "}{field.envVar}
                  </span>
                ) : null}
              </Label>
              <Input
                id={id}
                type={field.kind === "secret" && !touched ? "text" : "text"}
                value={touched ? edits[field.key] : locked ? (field.kind === "secret" ? "••••••••" : (field.display ?? "")) : (field.display ?? "")}
                placeholder={field.placeholder}
                readOnly={locked}
                disabled={locked || pending}
                className={cn(field.kind === "secret" && "font-mono text-xs", locked && "opacity-60")}
                onChange={(e) => setEdits((current) => ({ ...current, [field.key]: e.target.value }))}
                onFocus={(e) => {
                  // A masked secret is not a value anybody can edit — clear it so typing replaces it.
                  if (!locked && field.kind === "secret" && !touched) {
                    setEdits((current) => ({ ...current, [field.key]: "" }));
                    e.currentTarget.value = "";
                  }
                }}
              />
              {field.help ? <p className="text-2xs leading-4 text-muted-foreground">{field.help}</p> : null}
            </div>
          );
        })}
      </div>

      {setup ? (
        <div className={cn("mt-4 rounded-lg border p-3", setup.ok ? "border-green-soft bg-green-soft/40" : "border-amber-soft bg-amber-soft/40")}>
          <p className="flex items-start gap-1.5 text-[13px] font-medium">
            {setup.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-green-deep" /> : <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-deep" />}
            {setup.summary}
          </p>
          {setup.steps.length ? (
            <ul className="mt-2 space-y-1">
              {setup.steps.map((step) => (
                <li key={step.label} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  {step.ok ? <Check className="mt-0.5 size-3 shrink-0 text-green-deep" /> : <X className="mt-0.5 size-3 shrink-0 text-coral-deep" />}
                  <span>
                    <span className="font-medium text-foreground">{step.label}</span> — {step.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {testResult ? (
        <p className={cn("mt-3 flex items-start gap-1.5 text-xs", testResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
          {testResult.ok ? <Check className="mt-0.5 size-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 size-3.5 shrink-0" />}
          {testResult.message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} loading={pending && dirty} disabled={!dirty}>
          <Plug />{" "}{tr("Save")}</Button>
        {setupLabel ? (
          <Button size="sm" variant={ready ? "outline" : "ghost"} onClick={runSetup} loading={pending && !dirty} disabled={pending || !ready}>
            <Wand2 /> {setupLabel}
          </Button>
        ) : null}
        {integration.testable ? (
          <Button size="sm" variant="ghost" onClick={test} disabled={pending || !ready}>
            {integration.testLabel === "Show routing" ? tr("Show routing") : tr("Test connection")}</Button>
        ) : null}
        {integration.configured && integration.fields.some((f) => f.source === "stored") ? (
          <Button size="sm" variant="ghost" onClick={disconnect} disabled={pending}>
            <Unplug />{" "}{tr("Disconnect")}</Button>
        ) : null}
      </div>
    </section>
  );
}
