"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookUser, CheckCircle2, Download, FileSpreadsheet, TriangleAlert, Upload, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { SectionTitle } from "@/components/newsroom/page-header";
import { commitImportAction, parseImportFileAction, validateImportAction, type ParsedUpload } from "@/app/(newsroom)/directory/import/actions";
import { ImportPreviewTable } from "./import-preview-table";
import type { ColumnMapping, CommitReport, ImportOptions, MappableField, MappingMode, ValidationResult } from "@/server/audience/import";
import { useUi } from "@/components/i18n/provider";

type Step = "upload" | "map" | "review" | "done";
type FieldSpec = { field: MappableField; label: string; required: boolean; hint: string };

const SEPARATE_FIELDS: FieldSpec[] = [
  { field: "firstName", label: "First name", required: true, hint: "prénom / first / given" },
  { field: "lastName", label: "Last name", required: false, hint: "nom / last / surname" },
  { field: "email", label: "Email", required: true, hint: "email / mail / courriel" },
  { field: "segment", label: "Segment", required: false, hint: "type / audience — defaults to Other" },
  { field: "organisation", label: "Organisation", required: false, hint: "partner / company / association" },
  { field: "campus", label: "Campus", required: false, hint: "campus / site / ville" },
];
const FULLNAME_FIELDS: FieldSpec[] = [
  { field: "fullName", label: "Full name", required: true, hint: "split into first / last on the last space" },
  { field: "email", label: "Email", required: true, hint: "email / mail / courriel" },
  { field: "segment", label: "Segment", required: false, hint: "type / audience — defaults to Other" },
  { field: "organisation", label: "Organisation", required: false, hint: "partner / company / association" },
  { field: "campus", label: "Campus", required: false, hint: "campus / site / ville" },
];

const TEMPLATE_CSV = "First name,Last name,Email,Segment,Organisation,Campus\nAda,Lovelace,ada.lovelace@example.com,Parent,,\n";
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;
const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Map columns" },
  { key: "review", label: "Review & import" },
];
const PREVIEW_LIMIT = 50;

export function ImportWizard({ campusNames }: { campusNames: string[] }) {
  const tr = useUi();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [options, setOptions] = useState<ImportOptions>({ updateExisting: true, setActive: true });
  const [preview, setPreview] = useState<ValidationResult | null>(null);
  const [report, setReport] = useState<CommitReport | null>(null);

  const stepIndex = STEPS.findIndex((sstep) => sstep.key === step);
  const activeIndex = step === "done" ? STEPS.length : stepIndex;
  const fields = mapping?.mode === "fullName" ? FULLNAME_FIELDS : SEPARATE_FIELDS;
  const mapReady = !!mapping && mapping.email !== null && (mapping.mode === "fullName" ? mapping.fullName !== null : mapping.firstName !== null);

  function handleParse(file: File) {
    setFileName(file.name);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await parseImportFileAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setParsed(res.data);
      setMapping(res.data.guess);
      setPreview(null);
      setReport(null);
      setStep("map");
      if (res.message) toast.success(res.message);
    });
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleParse(file);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleParse(file);
  }

  function setField(field: MappableField, value: string) {
    setMapping((m) => (m ? { ...m, [field]: value === "" ? null : Number(value) } : m));
  }

  function setMode(mode: MappingMode) {
    setMapping((m) => (m ? { ...m, mode } : m));
  }

  function runValidate(nextOptions: ImportOptions) {
    if (!parsed || !mapping) return;
    startTransition(async () => {
      const res = await validateImportAction({ header: parsed.header, rows: parsed.rows, mapping, options: nextOptions });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPreview(res.data);
      setStep("review");
    });
  }

  function toggleUpdateExisting(v: boolean) {
    const next = { ...options, updateExisting: v };
    setOptions(next);
    runValidate(next);
  }

  function handleCommit() {
    if (!parsed || !mapping) return;
    startTransition(async () => {
      const res = await commitImportAction({ header: parsed.header, rows: parsed.rows, mapping, options });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setReport(res.data);
      setStep("done");
      toast.success(res.message ?? "Import complete");
      router.refresh();
    });
  }

  function reset() {
    setStep("upload");
    setFileName(null);
    setParsed(null);
    setMapping(null);
    setPreview(null);
    setReport(null);
    setOptions({ updateExisting: true, setActive: true });
  }

  return (
    <div className="space-y-4">
      {/* Stepper */}
      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((sstep, i) => (
          <li key={sstep.key} className="flex items-center gap-2">
            <span className={`flex size-5 items-center justify-center rounded-full text-2xs font-semibold ${i < activeIndex ? "bg-success text-white" : i === activeIndex ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground"}`}>
              {i < activeIndex ? <CheckCircle2 className="size-3.5" /> : i + 1}
            </span>
            <span className={i === activeIndex ? "font-medium text-foreground" : "text-muted-foreground"}>{tr(sstep.label)}</span>
            {i < STEPS.length - 1 ? <span className="mx-1 h-px w-6 bg-border" /> : null}
          </li>
        ))}
      </ol>

      {step === "upload" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center"
          >
            <div className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
              <UploadCloud className="size-5" />
            </div>
            <div>
              <p className="text-[13px] font-medium">{tr("Drop an .xlsx or .csv file here")}</p>
              <p className="text-xs text-muted-foreground">{tr("The first row must be your column headers.")}</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChosen} />
            <Button onClick={() => fileInputRef.current?.click()} loading={pending}>
              <Upload /> {" "}{tr("Choose a file")}</Button>
            {fileName ? <p className="text-2xs text-muted-foreground">{tr("Selected:")}{" "}{fileName}</p> : null}
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-3.5">
              <SectionTitle>{tr("Expected columns")}</SectionTitle>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li><span className="font-medium text-foreground">{tr("First name")}</span> {" "}{tr("(or a single full-name column)")}</li>
                <li><span className="font-medium text-foreground">{tr("Email")}</span> {" "}{tr("— required, one per recipient")}</li>
                <li><span className="font-medium text-foreground">{tr("Segment")}</span> {" "}{tr("— optional; defaults to Other")}</li>
                <li><span className="font-medium text-foreground">{tr("Organisation")}</span> {" "}{tr("and")}{" "}<span className="font-medium text-foreground">{tr("Campus")}</span> {" "}{tr("— optional")}</li>
              </ul>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <a href={TEMPLATE_HREF} download="recipients-template.csv"><Download /> {" "}{tr("Download CSV template")}</a>
              </Button>
            </div>
            {campusNames.length ? (
              <div className="rounded-lg border border-border bg-card p-3.5">
                <SectionTitle>{tr("Known campuses")}</SectionTitle>
                <p className="text-xs text-muted-foreground">{campusNames.join(" · ")}</p>
                <p className="mt-1.5 text-2xs text-muted-foreground">{tr("Anything else (or a blank cell) imports school-wide.")}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === "map" && parsed && mapping ? (
        <div className="space-y-4">
          <Alert>
            <FileSpreadsheet />
            <AlertTitle>{tr("Map your columns")}</AlertTitle>
            <AlertDescription>
              {tr("We guessed the mapping from “")}{parsed.sheetName}{tr("”. Check each field below.")}{parsed.truncated ? " Only the first rows were read." : ""}
            </AlertDescription>
          </Alert>

          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            <button type="button" onClick={() => setMode("separate")} className={`rounded px-2.5 py-1 font-medium ${mapping.mode === "separate" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}>{tr("Separate first / last")}</button>
            <button type="button" onClick={() => setMode("fullName")} className={`rounded px-2.5 py-1 font-medium ${mapping.mode === "fullName" ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}>{tr("Full name (one column)")}</button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.field} className="space-y-1.5">
                <Label>
                  {tr(f.label)}
                  {f.required ? <span className="text-destructive">*</span> : <span className="text-2xs font-normal text-muted-foreground">{tr("optional")}</span>}
                </Label>
                <NativeSelect value={mapping[f.field] === null ? "" : String(mapping[f.field])} onChange={(e) => setField(f.field, e.target.value)} aria-invalid={f.required && mapping[f.field] === null}>
                  <option value="">{tr("— not mapped —")}</option>
                  {parsed.header.map((h, i) => (
                    <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                  ))}
                </NativeSelect>
                <p className="text-2xs text-muted-foreground">{tr(f.hint)}</p>
              </div>
            ))}
          </div>

          <div>
            <SectionTitle>{tr("File preview")}</SectionTitle>
            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {parsed.header.map((h, i) => (
                      <TableHead key={i}>{h || `Column ${i + 1}`}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.rows.slice(0, 6).map((row, ri) => (
                    <TableRow key={ri}>
                      {parsed.header.map((_, ci) => (
                        <TableCell key={ci} className="whitespace-nowrap text-xs">{row[ci] ?? ""}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-1.5 text-2xs text-muted-foreground">{parsed.rows.length} {" "}{tr("data row")}{parsed.rows.length === 1 ? "" : "s"} {" "}{tr("in total.")}</p>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep("upload")}><ArrowLeft /> {" "}{tr("Back")}</Button>
            <Button onClick={() => runValidate(options)} loading={pending} disabled={!mapReady}>{tr("Preview import")}{" "}<ArrowRight /></Button>
          </div>
        </div>
      ) : null}

      {step === "review" && preview ? (
        <div className="space-y-4">
          <StatGrid columns={4}>
            <Stat label={tr("New")} value={preview.summary.toCreate} tone="success" hint={tr("will be created")} />
            <Stat label={tr("To update")} value={preview.summary.toUpdate} tone="brand" hint={tr("already in the directory")} />
            <Stat label={tr("Skipped")} value={preview.summary.toSkip} tone="muted" hint={`${preview.summary.invalid} invalid · ${preview.summary.duplicatesInFile} duplicate`} />
            <Stat label={tr("Rows read")} value={preview.summary.total} hint={preview.summary.campusUnresolved ? `${preview.summary.campusUnresolved} unknown campus` : "all campuses resolved"} />
          </StatGrid>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
              <span>{tr("Update recipients that already exist")}</span>
              <Switch checked={options.updateExisting} onCheckedChange={toggleUpdateExisting} disabled={pending} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
              <span>{tr("Set imported recipients active")}</span>
              <Switch checked={options.setActive} onCheckedChange={(v) => setOptions((o) => ({ ...o, setActive: v }))} disabled={pending} />
            </label>
          </div>

          {preview.summary.toCreate + preview.summary.toUpdate === 0 ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>{tr("Nothing to import")}</AlertTitle>
              <AlertDescription>{tr("Every row is skipped. Adjust the mapping or the switches above.")}</AlertDescription>
            </Alert>
          ) : null}

          <div>
            <SectionTitle>{`Preview — first ${Math.min(PREVIEW_LIMIT, preview.rows.length)} of ${preview.rows.length} rows`}</SectionTitle>
            <ImportPreviewTable rows={preview.rows.slice(0, PREVIEW_LIMIT)} />
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => setStep("map")}><ArrowLeft /> {" "}{tr("Back to mapping")}</Button>
            <Button onClick={handleCommit} loading={pending} disabled={preview.summary.toCreate + preview.summary.toUpdate === 0}>
              {tr("Import")}{" "}{preview.summary.toCreate + preview.summary.toUpdate} {" "}{tr("recipient")}{preview.summary.toCreate + preview.summary.toUpdate === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "done" && report ? (
        <div className="space-y-4">
          <Alert variant={report.failed ? "warning" : "success"}>
            <CheckCircle2 />
            <AlertTitle>{tr("Import complete")}</AlertTitle>
            <AlertDescription>
              {report.created} {" "}{tr("created,")}{" "}{report.updated} {" "}{tr("updated,")}{" "}{report.skipped} {" "}{tr("skipped")}{report.failed ? `, ${report.failed} failed` : ""}.
            </AlertDescription>
          </Alert>

          {report.failures.length ? (
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-3 py-2 text-xs font-medium">{tr("Failures")}</div>
              <ul className="divide-y divide-border">
                {report.failures.map((f) => (
                  <li key={f.line} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                    <span className="text-muted-foreground">{tr("Line")}{" "}{f.line} · {f.email || "—"}</span>
                    <span className="text-destructive">{f.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button asChild><Link href="/directory"><BookUser /> {" "}{tr("Back to the directory")}</Link></Button>
            <Button variant="outline" onClick={reset}><Upload /> {" "}{tr("Import another file")}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
