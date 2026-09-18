"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveWorkspaceAction, type WorkspaceInput } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/components/i18n/provider";
import { useUi } from "@/components/i18n/provider";

const TYPES = [
  ["COMPANY", "Company"],
  ["SCHOOL", "School"],
  ["UNIVERSITY", "University"],
  ["ASSOCIATION", "Association"],
  ["COMMUNITY", "Community"],
  ["INVESTOR", "Investment firm"],
  ["MEDIA", "Media"],
  ["INSTITUTION", "Institution"],
  ["OTHER", "Other"],
] as const;

export type WorkspaceValues = WorkspaceInput & { slug: string };

export function WorkspaceForm({ initial, canEdit }: { initial: WorkspaceValues; canEdit: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<WorkspaceInput>(initial);

  const set = <K extends keyof WorkspaceInput>(key: K, value: WorkspaceInput[K]) => setValues((v) => ({ ...v, [key]: value }));

  function submit() {
    startTransition(async () => {
      const result = await saveWorkspaceAction(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(tr("Workspace saved"));
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ws-name">{t("workspace.name")}</Label>
          <Input id="ws-name" value={values.name} onChange={(e) => set("name", e.target.value)} disabled={!canEdit} />
          <p className="text-xs text-muted-foreground">
            {t("workspace.publicAddress")}: <span className="font-mono">/{initial.slug}</span>
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-type">{t("onboarding.type")}</Label>
          <NativeSelect id="ws-type" value={values.type} onChange={(e) => set("type", e.target.value as WorkspaceInput["type"])} disabled={!canEdit}>
            {TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-locale">{t("workspace.interfaceLanguage")}</Label>
          <NativeSelect id="ws-locale" value={values.locale} onChange={(e) => set("locale", e.target.value as WorkspaceInput["locale"])} disabled={!canEdit}>
            <option value="en">{tr("English")}</option>
            <option value="fr">{tr("Français")}</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-website">{t("workspace.website")}</Label>
          <Input id="ws-website" value={values.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder={tr("https://acme.com")} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-timezone">{t("workspace.timezone")}</Label>
          <Input id="ws-timezone" value={values.timezone} onChange={(e) => set("timezone", e.target.value)} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ws-description">{t("workspace.description")}</Label>
          <Textarea id="ws-description" rows={2} value={values.description ?? ""} onChange={(e) => set("description", e.target.value)} disabled={!canEdit} />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <p className="label-caps">{t("workspace.brand")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ws-logo">{t("workspace.logoUrl")}</Label>
            <Input id="ws-logo" value={values.logoUrl ?? ""} onChange={(e) => set("logoUrl", e.target.value)} placeholder={tr("https://acme.com/logo.svg")} disabled={!canEdit} />
          </div>
          {(
            [
              ["primary", t("workspace.primaryColour")],
              ["accent", t("workspace.accentColour")],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`ws-${key}`}>{label}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={label}
                  value={values[key] || "#101014"}
                  onChange={(e) => set(key, e.target.value)}
                  disabled={!canEdit}
                  className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
                />
                <Input id={`ws-${key}`} value={values[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={tr("#2BAFE0")} className="font-mono" disabled={!canEdit} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("workspace.brandHint")}</p>
      </div>

      {canEdit ? (
        <Button onClick={submit} loading={pending}>
          {t("workspace.saveWorkspace")}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">{t("workspace.adminOnly")}</p>
      )}
    </div>
  );
}
