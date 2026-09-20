"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SettingsCard } from "@/components/settings/key-value";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";
import {
  commitSubscriberImportAction,
  parseSubscriberFileAction,
  previewSubscriberImportAction,
  type ParsedSubscriberUpload,
} from "@/app/(newsroom)/subscribers/actions";
import type { SubscriberImportReport, SubscriberMapping, SubscriberPreview } from "@/server/subscribers/manage";

type Step = "upload" | "map" | "preview" | "done";

const FIELDS: { key: keyof SubscriberMapping; label: string; required?: boolean }[] = [
  { key: "email", label: "Email", required: true },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "fullName", label: "Full name" },
  { key: "locale", label: "Language" },
];

/**
 * A spreadsheet, its columns matched by hand, and a rehearsal before anything is written.
 *
 * Briefly guesses the mapping and is often right, but the guess is a suggestion on a form rather
 * than a decision taken for you: somebody whose file calls the address column "Contact" fixes it
 * in one click. The preview is the whole point — every row says what it will do and why, and
 * nothing is written until it is read.
 */
export function SubscriberImportWizard({ titles }: { titles: { id: string; name: string }[] }) {
  const tr = useUi();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSubscriberUpload | null>(null);
  const [mapping, setMapping] = useState<SubscriberMapping | null>(null);
  const [preview, setPreview] = useState<SubscriberPreview | null>(null);
  const [report, setReport] = useState<SubscriberImportReport | null>(null);
  const [publicationIds, setPublicationIds] = useState<string[]>(titles.length === 1 ? [titles[0].id] : []);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [resubscribe, setResubscribe] = useState(false);

  function upload(file: File) {
    setFileName(file.name);
    const body = new FormData();
    body.append("file", file);
    start(async () => {
      const result = await parseSubscriberFileAction(body);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setParsed(result.data);
      setMapping(result.data.guess);
      setStep("map");
      if (result.data.truncated) toast.warning(tr("Only the first rows were read; the rest of the file is too long."));
    });
  }

  function toPreview() {
    if (!parsed || !mapping) return;
    start(async () => {
      const result = await previewSubscriberImportAction({ rows: parsed.rows, mapping, options: { updateExisting, resubscribe } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.data);
      setStep("preview");
    });
  }

  function commit() {
    if (!parsed || !mapping) return;
    start(async () => {
      const result = await commitSubscriberImportAction({ rows: parsed.rows, mapping, options: { publicationIds, updateExisting, resubscribe } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setReport(result.data);
      setStep("done");
      router.refresh();
    });
  }

  const ready = Boolean(mapping && mapping.email !== null && (mapping.mode === "fullName" ? mapping.fullName !== null : true));

  return (
    <div className="space-y-4">
      {step === "upload" ? (
        <SettingsCard title={tr("The file")} description={tr("An Excel file or a CSV. The first row must name the columns; everything else is read as people.")}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
            }}
          />
          <Button onClick={() => fileRef.current?.click()} loading={pending}>
            <Upload /> {tr("Choose a file")}
          </Button>
        </SettingsCard>
      ) : null}

      {step === "map" && parsed && mapping ? (
        <SettingsCard title={tr("Which column is what")} description={`${fileName ?? parsed.sheetName} · ${tr("{count} rows", { count: parsed.rows.length })}`}>
          <div className="space-y-2">
            {FIELDS.map((field) => (
              <div key={field.key as string} className="flex flex-wrap items-center gap-2">
                <Label className="w-28 shrink-0" htmlFor={`map-${String(field.key)}`}>
                  {tr(field.label)}
                  {field.required ? <span className="text-destructive"> *</span> : null}
                </Label>
                <NativeSelect
                  id={`map-${String(field.key)}`}
                  className="w-64"
                  value={mapping[field.key] === null || typeof mapping[field.key] !== "number" ? "" : String(mapping[field.key])}
                  onChange={(event) => {
                    const index = event.target.value === "" ? null : Number(event.target.value);
                    setMapping((current) => (current ? { ...current, [field.key]: index, mode: field.key === "fullName" && index !== null ? "fullName" : current.mode } : current));
                  }}
                >
                  <option value="">{tr("— not in the file —")}</option>
                  {parsed.header.map((name, index) => (
                    <option key={`${name}-${index}`} value={index}>
                      {name || tr("Column {n}", { n: index + 1 })}
                    </option>
                  ))}
                </NativeSelect>
                {parsed.rows[0] && typeof mapping[field.key] === "number" ? (
                  <span className="truncate text-2xs text-muted-foreground">{tr("e.g.")} {parsed.rows[0][mapping[field.key] as number] || "—"}</span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Label className="w-28 shrink-0">{tr("Names")}</Label>
            <NativeSelect
              className="w-64"
              value={mapping.mode}
              onChange={(event) => setMapping((current) => (current ? { ...current, mode: event.target.value === "fullName" ? "fullName" : "separate" } : current))}
              aria-label={tr("How the names are written")}
            >
              <option value="separate">{tr("First and last name in two columns")}</option>
              <option value="fullName">{tr("One column with the whole name")}</option>
            </NativeSelect>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep("upload")}>
              {tr("Back")}
            </Button>
            <Button onClick={toPreview} loading={pending} disabled={!ready}>
              {tr("See what will happen")} <ArrowRight />
            </Button>
          </div>
        </SettingsCard>
      ) : null}

      {step === "preview" && preview ? (
        <>
          <SettingsCard title={tr("What will happen")} description={tr("Nothing has been written yet.")}>
            <div className="flex flex-wrap gap-2 text-[13px]">
              <Badge variant="success">{tr("{count} to add", { count: preview.summary.toCreate })}</Badge>
              <Badge variant="outline">{tr("{count} to update", { count: preview.summary.toUpdate })}</Badge>
              <Badge variant="muted">{tr("{count} left alone", { count: preview.summary.toSkip })}</Badge>
              {preview.summary.invalid ? <Badge variant="destructive">{tr("{count} without a usable address", { count: preview.summary.invalid })}</Badge> : null}
              {preview.summary.duplicates ? <Badge variant="warning">{tr("{count} twice in the file", { count: preview.summary.duplicates })}</Badge> : null}
            </div>

            <ul className="mt-3 max-h-72 divide-y divide-border/70 overflow-y-auto rounded-md border border-border">
              {preview.rows.slice(0, 200).map((row) => (
                <li key={row.line} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs">
                  <span className="tabular w-8 shrink-0 text-muted-foreground">{row.line}</span>
                  <span className={cn("w-64 shrink-0 truncate", row.status === "skip" && "text-muted-foreground line-through")}>{row.email || tr("(no address)")}</span>
                  <span className="min-w-0 flex-1 truncate">{[row.firstName, row.lastName].filter(Boolean).join(" ")}</span>
                  <Badge variant={row.status === "create" ? "success" : row.status === "update" ? "outline" : "muted"}>
                    {row.status === "create" ? tr("add") : row.status === "update" ? tr("update") : tr("leave")}
                  </Badge>
                  {row.notes.length ? <span className="w-48 shrink-0 truncate text-2xs text-muted-foreground">{row.notes.map((note) => tr(note)).join(" · ")}</span> : null}
                </li>
              ))}
            </ul>
          </SettingsCard>

          <SettingsCard title={tr("Where they go")} description={tr("The newsletters these readers will receive.")}>
            <ul className="space-y-1">
              {titles.map((title) => (
                <li key={title.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted/60">
                    <Checkbox
                      checked={publicationIds.includes(title.id)}
                      onCheckedChange={(on) => setPublicationIds((current) => (on === true ? [...current, title.id] : current.filter((id) => id !== title.id)))}
                      aria-label={title.name}
                    />
                    {title.name}
                  </label>
                </li>
              ))}
              {!titles.length ? <li className="text-xs text-muted-foreground">{tr("No newsletter is taking subscribers yet.")}</li> : null}
            </ul>
            <div className="mt-3 space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox checked={updateExisting} onCheckedChange={(on) => setUpdateExisting(on === true)} aria-label={tr("Update people already on the list")} />
                {tr("Update people already on the list")}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox checked={resubscribe} onCheckedChange={(on) => setResubscribe(on === true)} aria-label={tr("Put back anybody who had unsubscribed")} />
                {tr("Put back anybody who had unsubscribed")}
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep("map")}>
                {tr("Back")}
              </Button>
              <Button onClick={commit} loading={pending}>
                <Check /> {tr("Import them")}
              </Button>
            </div>
          </SettingsCard>
        </>
      ) : null}

      {step === "done" && report ? (
        <SettingsCard title={tr("Done")} description={tr("{created} added · {updated} updated · {skipped} left alone", { created: report.created, updated: report.updated, skipped: report.skipped })}>
          {report.failures.length ? (
            <ul className="space-y-1 text-xs">
              {report.failures.slice(0, 20).map((failure) => (
                <li key={`${failure.line}-${failure.email}`} className="text-destructive">
                  {tr("Row {line}", { line: failure.line })} · {failure.email} · {failure.error}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <FileSpreadsheet className="size-4" /> {tr("Every row went in.")}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <Button onClick={() => router.push("/subscribers")}>{tr("See the list")}</Button>
          </div>
        </SettingsCard>
      ) : null}
    </div>
  );
}
