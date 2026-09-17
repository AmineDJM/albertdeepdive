import * as XLSX from "xlsx";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ValidationError } from "@/lib/action-result";
import { CONTRIBUTOR_TYPES, type ContributorType } from "@/lib/constants";
import { enumLabel } from "@/lib/utils";
import { createContributor, listCampusesWithStats, updateContributor } from "./service";

// ── Types ───────────────────────────────────────────────────────────────────

/** How the operator maps the file's columns onto contributor fields. Values are column indices. */
export type MappingMode = "separate" | "fullName";
export type MappableField = "firstName" | "lastName" | "fullName" | "email" | "campus" | "type";
export type ColumnMapping = {
  mode: MappingMode;
  firstName: number | null;
  lastName: number | null;
  fullName: number | null;
  email: number | null;
  campus: number | null;
  type: number | null;
};

export type ImportOptions = { updateExisting: boolean; setActive: boolean };

export type CampusRef = { id: string; name: string; slug: string };
export type ExistingContributor = { id: string; email: string };

export type ParsedWorkbook = { sheetName: string; header: string[]; rows: string[][]; truncated: boolean };

export type RowStatus = "create" | "update" | "skip";
export type BadgeTone = "destructive" | "warning" | "info" | "muted" | "success";
export type RowBadge = { tone: BadgeTone; label: string };

export type PreviewRow = {
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  type: ContributorType;
  campusId: string | null;
  campusLabel: string;
  status: RowStatus;
  existingId: string | null;
  badges: RowBadge[];
};

export type ImportSummary = {
  total: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  invalid: number;
  duplicatesInFile: number;
  campusUnresolved: number;
};

export type ValidationResult = { rows: PreviewRow[]; summary: ImportSummary };

export type MapValidateInput = {
  header: string[];
  rows: string[][];
  mapping: ColumnMapping;
  campuses: CampusRef[];
  existing: ExistingContributor[];
  options: ImportOptions;
};

export type CommitInput = { header: string[]; rows: string[][]; mapping: ColumnMapping; options: ImportOptions };
export type CommitFailure = { line: number; email: string; error: string };
export type CommitReport = { total: number; created: number; updated: number; skipped: number; failed: number; failures: CommitFailure[] };

/** Rows above this are dropped from a single upload to keep the round-trip payload bounded. */
export const MAX_IMPORT_ROWS = 5000;

const emailSchema = z.string().email();
const DIACRITICS = /[̀-ͯ]/g;

// ── Normalisation helpers ────────────────────────────────────────────────────

/** Lower-cased, accent-stripped, separator-collapsed key used for fuzzy header and campus matching. */
export function normaliseForMatch(input: string): string {
  return input
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[\s._\-/]+/g, " ")
    .trim();
}

/** Split a single "full name" cell into first/last on the LAST space (so multi-word first names survive). */
export function splitFullName(value: string): { firstName: string; lastName: string } {
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return { firstName: "", lastName: "" };
  const idx = clean.lastIndexOf(" ");
  if (idx === -1) return { firstName: clean, lastName: "" };
  return { firstName: clean.slice(0, idx).trim(), lastName: clean.slice(idx + 1).trim() };
}

/** Map a free-text cell onto the contributor type enum; anything unrecognised (or blank) becomes STUDENT. */
export function resolveContributorType(cell: string): ContributorType {
  const raw = cell.trim();
  if (!raw) return "STUDENT";
  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");
  const direct = CONTRIBUTOR_TYPES.find((t) => t === key);
  if (direct) return direct;
  const byLabel = CONTRIBUTOR_TYPES.find((t) => enumLabel(t).toLowerCase() === raw.toLowerCase());
  return byLabel ?? "STUDENT";
}

function resolveCampus(cell: string, campuses: CampusRef[]): CampusRef | null {
  const key = normaliseForMatch(cell);
  if (!key) return null;
  return campuses.find((c) => normaliseForMatch(c.name) === key || normaliseForMatch(c.slug) === key) ?? null;
}

function pick(row: string[], idx: number | null): string {
  if (idx === null || idx < 0) return "";
  const value = row[idx];
  return value === undefined || value === null ? "" : String(value).trim();
}

// ── Header auto-guessing ──────────────────────────────────────────────────────

// Keywords are pre-normalised (accent-free, space-separated). Order within a field is priority.
const FIELD_KEYWORDS: Record<MappableField, string[]> = {
  email: ["email", "e mail", "mail", "courriel", "adresse mail"],
  firstName: ["prenom", "first name", "firstname", "first", "given name", "given"],
  lastName: ["last name", "lastname", "surname", "family name", "family", "nom de famille", "nom"],
  fullName: ["full name", "fullname", "nom complet", "nom et prenom", "name", "nom prenom"],
  campus: ["campus", "site", "ville", "city", "ecole", "school"],
  type: ["type", "role", "statut", "status", "fonction"],
};

function guessColumn(normalisedHeader: string[], keywords: string[], used: Set<number>): number | null {
  // Prefer an exact header match before falling back to a substring match.
  for (let i = 0; i < normalisedHeader.length; i++) {
    if (!used.has(i) && keywords.includes(normalisedHeader[i])) return i;
  }
  for (const kw of keywords) {
    for (let i = 0; i < normalisedHeader.length; i++) {
      if (!used.has(i) && normalisedHeader[i].length > 0 && normalisedHeader[i].includes(kw)) return i;
    }
  }
  return null;
}

/** Best-effort mapping from a header row. Fields are claimed in priority order so a column is never reused. */
export function guessMapping(header: string[]): ColumnMapping {
  const norm = header.map(normaliseForMatch);
  const used = new Set<number>();
  const claim = (field: MappableField): number | null => {
    const idx = guessColumn(norm, FIELD_KEYWORDS[field], used);
    if (idx !== null) used.add(idx);
    return idx;
  };
  const email = claim("email");
  const firstName = claim("firstName");
  const lastName = claim("lastName");
  const fullName = claim("fullName");
  const campus = claim("campus");
  const type = claim("type");
  const mode: MappingMode = firstName !== null && lastName !== null ? "separate" : fullName !== null ? "fullName" : "separate";
  return { mode, firstName, lastName, fullName, email, campus, type };
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/** Parse an .xlsx or .csv buffer into a header row and string rows (first sheet). */
export function parseWorkbook(buffer: Buffer): ParsedWorkbook {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new ValidationError("The file has no sheets");
  const sheet = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
  const matrix = raw.map((r) => (Array.isArray(r) ? r.map((c) => (c === undefined || c === null ? "" : String(c))) : []));
  const header = (matrix[0] ?? []).map((h) => h.trim());
  const dataRows = matrix.slice(1);
  const truncated = dataRows.length > MAX_IMPORT_ROWS;
  return { sheetName, header, rows: truncated ? dataRows.slice(0, MAX_IMPORT_ROWS) : dataRows, truncated };
}

// ── Pure map + validate ───────────────────────────────────────────────────────

/**
 * Resolve, normalise and validate every data row against the mapping and the current pool — WITHOUT writing.
 * Emails are trimmed and lower-cased; campuses are matched by name or slug (accent-insensitive); duplicates
 * (in the file and against the pool) and invalid emails are flagged. An unknown/blank campus is a soft note,
 * never a hard error (the contributor is created school-wide).
 */
export function mapAndValidateRows(input: MapValidateInput): ValidationResult {
  const { rows, mapping, campuses, existing, options } = input;
  const existingByEmail = new Map(existing.map((e) => [e.email.trim().toLowerCase(), e]));
  const seen = new Map<string, number>();
  const out: PreviewRow[] = [];
  const summary: ImportSummary = { total: rows.length, toCreate: 0, toUpdate: 0, toSkip: 0, invalid: 0, duplicatesInFile: 0, campusUnresolved: 0 };

  rows.forEach((row, i) => {
    const line = i + 2; // +1 for zero-index, +1 for the header row: matches the spreadsheet row number.
    const badges: RowBadge[] = [];

    let firstName = "";
    let lastName = "";
    if (mapping.mode === "fullName") {
      ({ firstName, lastName } = splitFullName(pick(row, mapping.fullName)));
    } else {
      firstName = pick(row, mapping.firstName);
      lastName = pick(row, mapping.lastName);
    }
    const email = pick(row, mapping.email).toLowerCase();
    const type = resolveContributorType(pick(row, mapping.type));

    const campusCell = pick(row, mapping.campus);
    const campus = resolveCampus(campusCell, campuses);
    const campusId = campus ? campus.id : null;
    const campusLabel = campus ? campus.name : "School-wide";
    if (!campus && campusCell) {
      badges.push({ tone: "warning", label: `Campus “${campusCell}” not found → school-wide` });
      summary.campusUnresolved += 1;
    }

    let status: RowStatus = "create";
    let existingId: string | null = null;
    const emailValid = email.length > 0 && emailSchema.safeParse(email).success;
    const nameValid = firstName.length > 0 && lastName.length > 0;

    if (!emailValid) {
      status = "skip";
      summary.invalid += 1;
      badges.unshift({ tone: "destructive", label: email ? "Invalid email" : "Missing email" });
    } else if (!nameValid) {
      status = "skip";
      summary.invalid += 1;
      badges.unshift({ tone: "destructive", label: mapping.mode === "fullName" ? "Could not split full name" : firstName ? "Missing last name" : "Missing name" });
    } else if (seen.has(email)) {
      status = "skip";
      summary.duplicatesInFile += 1;
      badges.unshift({ tone: "muted", label: `Duplicate in file (first at line ${seen.get(email)})` });
    } else {
      seen.set(email, line);
      const match = existingByEmail.get(email);
      if (match) {
        if (options.updateExisting) {
          status = "update";
          existingId = match.id;
          badges.unshift({ tone: "info", label: "Already in the pool → will update" });
        } else {
          status = "skip";
          badges.unshift({ tone: "muted", label: "Already in the pool → will skip" });
        }
      }
    }

    if (status === "create") summary.toCreate += 1;
    else if (status === "update") summary.toUpdate += 1;
    else summary.toSkip += 1;

    out.push({ line, firstName, lastName, email, type, campusId, campusLabel, status, existingId, badges });
  });

  return { rows: out, summary };
}

// ── Context + commit (DB) ─────────────────────────────────────────────────────

/** Load the campuses and the full email→id index of the existing pool (read-only). */
export async function loadImportContext(): Promise<{ campuses: CampusRef[]; existing: ExistingContributor[] }> {
  const [campusRows, contributorRows] = await Promise.all([
    listCampusesWithStats(),
    db.select({ id: s.contributors.id, email: s.contributors.email }).from(s.contributors),
  ]);
  return {
    campuses: campusRows.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    existing: contributorRows.map((c) => ({ id: c.id, email: c.email })),
  };
}

/**
 * Re-validate against the live pool, then create/update each resolved row via the contributor service,
 * one at a time, collecting per-row failures. Never throws for a single bad row.
 */
export async function commitImport(input: CommitInput, userId?: string | null): Promise<CommitReport> {
  const { campuses, existing } = await loadImportContext();
  const { rows } = mapAndValidateRows({ header: input.header, rows: input.rows, mapping: input.mapping, campuses, existing, options: input.options });
  const report: CommitReport = { total: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, failures: [] };

  for (const r of rows) {
    if (r.status === "skip") {
      report.skipped += 1;
      continue;
    }
    try {
      if (r.status === "create") {
        await createContributor({ firstName: r.firstName, lastName: r.lastName, email: r.email, campusId: r.campusId, type: r.type, isActive: input.options.setActive }, userId);
        report.created += 1;
      } else if (r.existingId) {
        await updateContributor(r.existingId, { firstName: r.firstName, lastName: r.lastName, campusId: r.campusId, type: r.type, isActive: input.options.setActive }, userId);
        report.updated += 1;
      }
    } catch (err) {
      report.failures.push({ line: r.line, email: r.email, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  report.failed = report.failures.length;
  return report;
}
