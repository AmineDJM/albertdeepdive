/**
 * A spreadsheet somebody can actually open.
 *
 * RFC 4180 quoting, `\r\n` line endings, and a byte-order mark in front — without the mark Excel
 * reads a UTF-8 file as the local code page and a French list of names comes out as mojibake,
 * which is the one thing that makes an export feel broken rather than merely plain.
 *
 * A cell that starts with =, +, - or @ is prefixed with an apostrophe. A spreadsheet treats those
 * as formulas, and a name field is not a place to run one.
 */
export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

const RISKY = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const safe = RISKY.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(column.value(row))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** The headers that make a browser save the file rather than show it. */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "-")}"`,
    "Cache-Control": "private, no-store",
  };
}

/** `subscribers-2026-09-20.csv`: what it is, and when it was taken. */
export function csvName(what: string, when = new Date()): string {
  return `${what}-${when.toISOString().slice(0, 10)}.csv`;
}
