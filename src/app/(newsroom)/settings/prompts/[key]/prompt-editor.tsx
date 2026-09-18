"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, History, RotateCcw, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import type { PromptDetail, PromptVersionRow } from "@/server/settings/prompts";
import { extractTemplateVariables } from "@/server/settings/prompt-versioning";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { SettingsCard } from "@/components/settings/key-value";
import { formatDateTime } from "@/lib/utils";
import { activatePromptVersionAction, restorePromptDefaultAction, savePromptVersionAction, testPromptAction } from "../actions";
import { useUi } from "@/components/i18n/provider";

type Draft = { systemPrompt: string; userPrompt: string; modelTier: "FAST" | "STRONG"; temperature: number; maxOutputTokens: number };

function draftFrom(detail: PromptDetail): Draft {
  const src = detail.active ?? detail.versions[0] ?? null;
  if (src) return { systemPrompt: src.systemPrompt, userPrompt: src.userPrompt, modelTier: src.modelTier, temperature: src.temperature, maxOutputTokens: src.maxOutputTokens };
  const d = detail.default!;
  return { systemPrompt: d.system, userPrompt: d.user, modelTier: d.tier, temperature: d.temperature, maxOutputTokens: d.maxOutputTokens };
}

export function PromptEditor({ detail }: { detail: PromptDetail }) {
  const tr = useUi();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(detail));
  const [loadedFrom, setLoadedFrom] = useState<number | null>(detail.active?.version ?? null);
  const [pending, start] = useTransition();
  const [test, setTest] = useState<{ open: boolean; variables: { name: string; value: string }[]; system: string; user: string } | null>(null);
  const baseline = useMemo(() => JSON.stringify(draftFrom(detail)), [detail]);
  const dirty = JSON.stringify(draft) !== baseline;
  const variables = useMemo(() => extractTemplateVariables(draft.systemPrompt, draft.userPrompt), [draft.systemPrompt, draft.userPrompt]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  function save() {
    start(async () => {
      const res = await savePromptVersionAction(detail.key, draft);
      if (!res.ok) {
        toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
        return;
      }
      toast.success(res.message);
      setLoadedFrom(res.data.version);
      router.refresh();
    });
  }

  function runTest(vars?: Record<string, string>) {
    start(async () => {
      const res = await testPromptAction({ systemPrompt: draft.systemPrompt, userPrompt: draft.userPrompt, variables: vars ?? {} });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTest({ open: true, ...res.data });
    });
  }

  function load(v: PromptVersionRow) {
    setDraft({ systemPrompt: v.systemPrompt, userPrompt: v.userPrompt, modelTier: v.modelTier, temperature: v.temperature, maxOutputTokens: v.maxOutputTokens });
    setLoadedFrom(v.version);
    toast.message(`Version ${v.version} loaded into the editor`);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <SettingsCard
          title={tr("Template")}
          description={`Editing ${loadedFrom ? `from version ${loadedFrom}` : "the shipped default"}. Saving creates a new version and activates it.`}
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => runTest()} loading={pending}>
                <FlaskConical /> {" "}{tr("Test prompt")}</Button>
              <Button size="sm" onClick={save} loading={pending} disabled={!dirty && loadedFrom === (detail.active?.version ?? null)}>
                <Save /> {" "}{tr("Save as new version")}</Button>
            </div>
          }
        >
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="prompt-system">{tr("System prompt")}</Label>
              <Textarea id="prompt-system" value={draft.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} className="min-h-40 font-mono text-xs leading-5" spellCheck={false} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt-user">{tr("User prompt")}</Label>
              <Textarea id="prompt-user" value={draft.userPrompt} onChange={(e) => set("userPrompt", e.target.value)} className="min-h-56 font-mono text-xs leading-5" spellCheck={false} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="prompt-tier">{tr("Model tier")}</Label>
                <NativeSelect id="prompt-tier" value={draft.modelTier} onChange={(e) => set("modelTier", e.target.value as "FAST" | "STRONG")}>
                  <option value="FAST">{tr("FAST — cheap, quick (classification, extraction)")}</option>
                  <option value="STRONG">{tr("STRONG — writing and judgement")}</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prompt-temp">{tr("Temperature")}</Label>
                <Input id="prompt-temp" type="number" min={0} max={2} step={0.1} value={draft.temperature} onChange={(e) => set("temperature", Number(e.target.value))} className="tabular" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prompt-tokens">{tr("Max output tokens")}</Label>
                <Input id="prompt-tokens" type="number" min={50} max={32000} step={50} value={draft.maxOutputTokens} onChange={(e) => set("maxOutputTokens", Number(e.target.value))} className="tabular" />
              </div>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard title={tr("Versions")} description={tr("Every save is kept. Activate an older version to roll back; load one to start editing from it.")}>
          {detail.versions.length ? (
            <ol className="divide-y divide-border">
              {detail.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <div className="w-12 shrink-0 font-mono text-xs">v{v.version}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {v.isActive ? <Badge variant="success">{tr("Active")}</Badge> : null}
                      <span className="text-muted-foreground">
                        {formatDateTime(v.createdAt)}
                        {v.createdBy ? ` · ${v.createdBy}` : " · system"}
                      </span>
                      <Badge variant="outline">{v.modelTier}</Badge>
                      <span className="text-2xs text-muted-foreground">t={v.temperature} · {v.maxOutputTokens} {" "}{tr("tok")}</span>
                    </div>
                    <div className="mt-0.5 truncate text-2xs text-muted-foreground">{v.changeSummary}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="xs" variant="ghost" onClick={() => load(v)} aria-label={`Load version ${v.version} into the editor`}>
                      <Upload /> {" "}{tr("Load")}</Button>
                    {!v.isActive ? (
                      <Button
                        size="xs"
                        variant="outline"
                        loading={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await activatePromptVersionAction(detail.key, v.version);
                            if (!res.ok) {
                              toast.error(res.error);
                              return;
                            }
                            toast.success(res.message);
                            router.refresh();
                          })
                        }
                      >
                        <History /> {" "}{tr("Activate")}</Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">{tr("No saved versions yet — the pipeline uses the shipped default.")}</p>
          )}
        </SettingsCard>
      </div>

      <aside className="space-y-4">
        <SettingsCard title={tr("Variables")} description={tr("Filled from the pipeline at run time.")}>
          {variables.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {variables.map((v) => (
                <li key={v} className="rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-2xs">
                  {"{{"}
                  {v}
                  {"}}"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{tr("No variables — this template is static.")}</p>
          )}
        </SettingsCard>
        <SettingsCard title={tr("Shipped default")} description={tr("Restoring saves the default as a new active version; history is kept.")}>
          {detail.default ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  <RotateCcw /> {" "}{tr("Restore default")}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{tr("Restore the shipped default?")}</AlertDialogTitle>
                  <AlertDialogDescription>{tr("The default system and user prompts, tier, temperature and token limit become the active version. Your previous versions stay in the history.")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tr("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      start(async () => {
                        const res = await restorePromptDefaultAction(detail.key);
                        if (!res.ok) {
                          toast.error(res.error);
                          return;
                        }
                        toast.success(res.message);
                        router.refresh();
                      })
                    }
                  >
                    {tr("Restore")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <p className="text-xs text-muted-foreground">{tr("This key has no code default; it only exists in the database.")}</p>
          )}
        </SettingsCard>
      </aside>

      <Sheet open={!!test?.open} onOpenChange={(open) => setTest((t) => (t ? { ...t, open } : t))}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{tr("Rendered prompt")}</SheetTitle>
            <SheetDescription>{tr("The template filled with sample variables — exactly what the model would receive. No model call is made.")}</SheetDescription>
          </SheetHeader>
          {test ? (
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 scrollbar-thin">
              {test.variables.length ? (
                <div className="space-y-2">
                  <div className="label-caps">{tr("Sample variables")}</div>
                  <div className="grid gap-2">
                    {test.variables.map((v) => (
                      <div key={v.name} className="grid grid-cols-[140px_minmax(0,1fr)] items-start gap-2">
                        <code className="pt-1.5 font-mono text-2xs text-muted-foreground">{v.name}</code>
                        <Input value={v.value} onChange={(e) => setTest((t) => (t ? { ...t, variables: t.variables.map((x) => (x.name === v.name ? { ...x, value: e.target.value } : x)) } : t))} className="h-7 text-xs" />
                      </div>
                    ))}
                  </div>
                  <Button size="xs" variant="outline" loading={pending} onClick={() => runTest(Object.fromEntries(test.variables.map((v) => [v.name, v.value])))}>
                    <FlaskConical /> {" "}{tr("Re-render with these values")}</Button>
                </div>
              ) : null}
              <div>
                <div className="label-caps mb-1">{tr("System")}</div>
                <pre className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11.5px] leading-[1.5] whitespace-pre-wrap">{test.system}</pre>
              </div>
              <div>
                <div className="label-caps mb-1">{tr("User")}</div>
                <pre className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11.5px] leading-[1.5] whitespace-pre-wrap">{test.user}</pre>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
