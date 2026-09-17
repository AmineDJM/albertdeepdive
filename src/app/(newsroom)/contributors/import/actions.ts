"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { ok, toActionFailure, ValidationError, type ActionResult } from "@/lib/action-result";
import {
  commitImport,
  guessMapping,
  loadImportContext,
  mapAndValidateRows,
  parseWorkbook,
  type ColumnMapping,
  type CommitReport,
  type ImportOptions,
  type ValidationResult,
} from "@/server/contributors/import";

const MAX_BYTES = 8 * 1024 * 1024;

export type ParsedUpload = { sheetName: string; header: string[]; rows: string[][]; truncated: boolean; guess: ColumnMapping };
type ValidateInput = { header: string[]; rows: string[][]; mapping: ColumnMapping; options: ImportOptions };

/** Reject a mapping that is missing a required column before we bother validating rows. */
function assertMapping(mapping: ColumnMapping) {
  if (mapping.email === null) throw new ValidationError("Map the Email column");
  if (mapping.mode === "fullName") {
    if (mapping.fullName === null) throw new ValidationError("Map the Full name column");
  } else if (mapping.firstName === null || mapping.lastName === null) {
    throw new ValidationError("Map both First name and Last name (or switch to the full-name column)");
  }
}

/** Step 1 — parse the uploaded file on the server and return the header, rows and a guessed mapping. */
export async function parseImportFileAction(formData: FormData): Promise<ActionResult<ParsedUpload>> {
  try {
    await requirePermission("contributor:manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a file to import");
    if (file.size > MAX_BYTES) throw new ValidationError("That file is too large (8 MB maximum)");
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
      throw new ValidationError("Upload an .xlsx or .csv file");
    }
    const parsed = parseWorkbook(Buffer.from(await file.arrayBuffer()));
    if (parsed.header.length === 0) throw new ValidationError("The first row must contain column headers");
    if (parsed.rows.length === 0) throw new ValidationError("The file has headers but no data rows");
    const guess = guessMapping(parsed.header);
    const message = `Read ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} from “${parsed.sheetName}”${parsed.truncated ? ` (first ${parsed.rows.length} kept)` : ""}`;
    return ok({ ...parsed, guess }, message);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Step 3 — resolve and validate every row against the live pool without writing anything. */
export async function validateImportAction(input: ValidateInput): Promise<ActionResult<ValidationResult>> {
  try {
    await requirePermission("contributor:manage");
    assertMapping(input.mapping);
    const { campuses, existing } = await loadImportContext();
    const result = mapAndValidateRows({ header: input.header, rows: input.rows, mapping: input.mapping, campuses, existing, options: input.options });
    return ok(result);
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Step 4 — create new contributors and update existing ones by email, collecting per-row outcomes. */
export async function commitImportAction(input: ValidateInput): Promise<ActionResult<CommitReport>> {
  try {
    const user = await requirePermission("contributor:manage");
    assertMapping(input.mapping);
    const report = await commitImport(input, user.id);
    revalidatePath("/contributors");
    const parts = [`${report.created} created`, `${report.updated} updated`, `${report.skipped} skipped`];
    if (report.failed) parts.push(`${report.failed} failed`);
    return ok(report, parts.join(" · "));
  } catch (err) {
    return toActionFailure(err);
  }
}
