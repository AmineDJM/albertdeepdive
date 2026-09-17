import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { guessColumn, normaliseForMatch, splitFullName, type CampusRef, type CommitFailure, type CommitReport, type ImportOptions, type ImportSummary, type RowBadge, type RowStatus } from "@/server/contributors/import";
import { listCampusesWithStats } from "@/server/contributors/service";
import { createRecipient, updateRecipient } from "./service";
import { scoped } from "@/server/tenancy/scope";

// Generic parsing, normalisation and result shapes are shared with the contributor import (keeps the
// wizard identical); only the mappable fields and the segment/campus resolution differ here.
export { parseWorkbook, MAX_IMPORT_ROWS } from "@/server/contributors/import";
export type { BadgeTone, CampusRef, CommitFailure, CommitReport, ImportOptions, ImportSummary, ParsedWorkbook, RowBadge, RowStatus } from "@/server/contributors/import";

type AudienceSegment = (typeof s.audienceSegmentEnum.enumValues)[number];

// ── Types ───────────────────────────────────────────────────────────────────

/** How the operator maps the file's columns onto recipient fields. Values are column indices. */
export type MappingMode = "separate" | "fullName";
export type MappableField = "firstName" | "lastName" | "fullName" | "email" | "campus" | "segment" | "organisation";
export type ColumnMapping = {
  mode: MappingMode;
  firstName: number | null;
  lastName: number | null;
  fullName: number | null;
  email: number | null;
  campus: number | null;
  segment: number | null;
  organisation: number | null;
};

export type ExistingRecipient = { id: string; email: string };

export type PreviewRow = {
  line: number;
  firstName: string;
  lastName: string;
  email: string;
  segment: AudienceSegment;
  organisation: string | null;
  campusId: string | null;
  campusLabel: string;
  status: RowStatus;
  existingId: string | null;
  badges: RowBadge[];
};

export type ValidationResult = { rows: PreviewRow[]; summary: ImportSummary };

export type MapValidateInput = {
  header: string[];
  rows: string[][];
  mapping: ColumnMapping;
  campuses: CampusRef[];
  existing: ExistingRecipient[];
  options: ImportOptions;
};

export type CommitInput = { header: string[]; rows: string[][]; mapping: ColumnMapping; options: ImportOptions };

const emailSchema = z.string().email();

// ── Resolution helpers ────────────────────────────────────────────────────────

/** Map a free-text cell onto the audience segment enum; anything unrecognised (or blank) becomes OTHER. */
export function resolveSegment(cell: string): AudienceSegment {
  const raw = cell.trim();
  if (!raw) return "OTHER";
  const direct = s.audienceSegmentEnum.enumValues.find((v) => v === raw.toUpperCase().replace(/[\s-]+/g, "_"));
  if (direct) return direct;
  const key = normaliseForMatch(raw);
  const has = (...needles: string[]) => needles.some((n) => key.includes(n));
  if (has("parent", "famille", "family")) return "PARENT";
  if (has("partner", "partenaire", "sponsor")) return "PARTNER";
  if (has("admin")) return "ADMINISTRATION";
  if (has("alumni", "alumn", "ancien", "diplome", "graduate")) return "ALUMNI";
  if (has("staff", "personnel", "faculty", "professor", "enseignant")) return "STAFF";
  if (has("student", "etudiant", "eleve", "pupil")) return "STUDENT";
  return "OTHER";
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
  segment: ["segment", "type", "categorie", "category", "audience", "role", "groupe", "group", "public", "statut"],
  organisation: ["organisation", "organization", "org", "entreprise", "company", "societe", "partenaire", "partner", "structure"],
};

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
  const segment = claim("segment");
  const organisation = claim("organisation");
  const mode: MappingMode = firstName !== null ? "separate" : fullName !== null ? "fullName" : "separate";
  return { mode, firstName, lastName, fullName, email, campus, segment, organisation };
}

// ── Pure map + validate ───────────────────────────────────────────────────────

/**
 * Resolve, normalise and validate every data row against the mapping and the current directory — WITHOUT
 * writing. Emails are trimmed and lower-cased; campuses are matched by name or slug (accent-insensitive);
 * duplicates (in the file and against the directory) and invalid emails are flagged. An unknown/blank campus
 * is a soft note, never a hard error (the recipient is created school-wide).
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
    const segment = resolveSegment(pick(row, mapping.segment));
    const organisation = pick(row, mapping.organisation) || null;

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
    const nameValid = firstName.length > 0;

    if (!emailValid) {
      status = "skip";
      summary.invalid += 1;
      badges.unshift({ tone: "destructive", label: email ? "Invalid email" : "Missing email" });
    } else if (!nameValid) {
      status = "skip";
      summary.invalid += 1;
      badges.unshift({ tone: "destructive", label: mapping.mode === "fullName" ? "Could not read a name" : "Missing name" });
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
          badges.unshift({ tone: "info", label: "Already in the directory → will update" });
        } else {
          status = "skip";
          badges.unshift({ tone: "muted", label: "Already in the directory → will skip" });
        }
      }
    }

    if (status === "create") summary.toCreate += 1;
    else if (status === "update") summary.toUpdate += 1;
    else summary.toSkip += 1;

    out.push({ line, firstName, lastName, email, segment, organisation, campusId, campusLabel, status, existingId, badges });
  });

  return { rows: out, summary };
}

// ── Context + commit (DB) ─────────────────────────────────────────────────────

/** Load the campuses and the full email→id index of the existing directory (read-only). */
export async function loadImportContext(): Promise<{ campuses: CampusRef[]; existing: ExistingRecipient[] }> {
  const [campusRows, recipientRows] = await Promise.all([
    listCampusesWithStats(),
    db.select({ id: s.audienceRecipients.id, email: s.audienceRecipients.email }).from(s.audienceRecipients).where(await scoped(s.audienceRecipients.organizationId)),
  ]);
  return {
    campuses: campusRows.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    existing: recipientRows.map((r) => ({ id: r.id, email: r.email })),
  };
}

/**
 * Re-validate against the live directory, then create/update each resolved row via the audience service,
 * one at a time, collecting per-row failures. Never throws for a single bad row.
 */
export async function commitImport(input: CommitInput, userId?: string | null): Promise<CommitReport> {
  const { campuses, existing } = await loadImportContext();
  const { rows } = mapAndValidateRows({ header: input.header, rows: input.rows, mapping: input.mapping, campuses, existing, options: input.options });
  const report: CommitReport = { total: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, failures: [] };
  const failures: CommitFailure[] = [];

  for (const r of rows) {
    if (r.status === "skip") {
      report.skipped += 1;
      continue;
    }
    try {
      if (r.status === "create") {
        await createRecipient({ email: r.email, firstName: r.firstName, lastName: r.lastName, segment: r.segment, organisation: r.organisation, campusId: r.campusId, isActive: input.options.setActive }, userId, "import");
        report.created += 1;
      } else if (r.existingId) {
        await updateRecipient(r.existingId, { firstName: r.firstName, lastName: r.lastName, segment: r.segment, organisation: r.organisation, campusId: r.campusId, isActive: input.options.setActive }, userId);
        report.updated += 1;
      }
    } catch (err) {
      failures.push({ line: r.line, email: r.email, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  report.failures = failures;
  report.failed = failures.length;
  return report;
}
