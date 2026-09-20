import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ValidationError } from "@/lib/action-result";
import { audit } from "@/server/audit";
import { checkLimit } from "@/server/billing/entitlements";
import { guessColumn, normaliseForMatch, parseWorkbook, splitFullName, MAX_IMPORT_ROWS, type ParsedWorkbook } from "@/server/contributors/import";

/**
 * Readers put on the list by the publisher rather than by themselves.
 *
 * Every other way onto the list is a person typing their own address and confirming it. This one
 * is a newsroom that already has its readers — in a spreadsheet, in another tool, on paper — and
 * has no intention of asking four hundred of them to sign up again.
 *
 * So these arrive confirmed, and say where they came from: `by-hand` or `import`. The publisher is
 * asserting the consent, which is why the source is recorded and audited rather than blended in
 * with the people who came through a form. Every email still carries its unsubscribe link, and an
 * address that had unsubscribed is never quietly put back — it is brought back only when somebody
 * explicitly asks for that, and the audit says so.
 */

export const manualSubscriberSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  locale: z.enum(["en", "fr"]).default("en"),
  publicationIds: z.array(z.uuid()).default([]),
  /** Whether an address that had unsubscribed may be put back on the list. Off by default. */
  resubscribe: z.boolean().default(false),
});
export type ManualSubscriberInput = z.input<typeof manualSubscriberSchema>;
export type AddOutcome = { id: string; created: boolean; skipped: "unsubscribed" | null };

function token() {
  return randomBytes(32).toString("base64url");
}

async function linkTitles(subscriberId: string, publicationIds: string[], organizationId: string) {
  if (!publicationIds.length) return;
  // A workspace may only add its own titles, whatever ids arrive.
  const mine = await db
    .select({ id: s.publications.id })
    .from(s.publications)
    .where(and(eq(s.publications.organizationId, organizationId), inArray(s.publications.id, publicationIds)));
  for (const publication of mine) {
    await db
      .insert(s.publicationSubscriptions)
      .values({ publicationId: publication.id, subscriberId, isActive: true })
      .onConflictDoUpdate({
        target: [s.publicationSubscriptions.publicationId, s.publicationSubscriptions.subscriberId],
        set: { isActive: true, unsubscribedAt: null },
      });
  }
}

/** Add one reader by hand. Returns what happened, because "already there" is not a failure. */
export async function addSubscriberByHand(organizationId: string, raw: ManualSubscriberInput, userId?: string | null): Promise<AddOutcome> {
  const input = manualSubscriberSchema.parse(raw);
  const existing = await db.query.subscribers.findFirst({
    where: and(eq(s.subscribers.organizationId, organizationId), eq(s.subscribers.email, input.email)),
  });

  if (!existing) {
    const room = await checkLimit(organizationId, "subscribers");
    if (!room.allowed) throw new ValidationError(room.message ?? "This workspace has reached its subscriber limit");
    const [created] = await db
      .insert(s.subscribers)
      .values({
        organizationId,
        email: input.email,
        firstName: input.firstName || null,
        lastName: input.lastName || null,
        locale: input.locale,
        status: "SUBSCRIBED",
        source: "by-hand",
        confirmedAt: new Date(),
        unsubscribeToken: token(),
      })
      .returning();
    await linkTitles(created.id, input.publicationIds, organizationId);
    await audit({ action: "subscriber.added", organizationId, userId, entityId: created.id, metadata: { source: "by-hand", titles: input.publicationIds.length } });
    return { id: created.id, created: true, skipped: null };
  }

  if (existing.status === "UNSUBSCRIBED" && !input.resubscribe) return { id: existing.id, created: false, skipped: "unsubscribed" };

  await db
    .update(s.subscribers)
    .set({
      firstName: input.firstName || existing.firstName,
      lastName: input.lastName || existing.lastName,
      locale: input.locale,
      status: "SUBSCRIBED",
      confirmedAt: existing.confirmedAt ?? new Date(),
      unsubscribedAt: null,
    })
    .where(eq(s.subscribers.id, existing.id));
  await linkTitles(existing.id, input.publicationIds, organizationId);
  await audit({ action: "subscriber.added", organizationId, userId, entityId: existing.id, metadata: { source: "by-hand", existing: true, wasUnsubscribed: existing.status === "UNSUBSCRIBED" } });
  return { id: existing.id, created: false, skipped: null };
}

/* ── The spreadsheet ──────────────────────────────────────────────────────────────────────── */

export type SubscriberMapping = {
  mode: "separate" | "fullName";
  email: number | null;
  firstName: number | null;
  lastName: number | null;
  fullName: number | null;
  locale: number | null;
};

export type SubscriberPreviewRow = {
  line: number;
  email: string;
  firstName: string;
  lastName: string;
  locale: "en" | "fr";
  status: "create" | "update" | "skip";
  notes: string[];
};
export type SubscriberPreview = { rows: SubscriberPreviewRow[]; summary: { total: number; toCreate: number; toUpdate: number; toSkip: number; invalid: number; duplicates: number } };
export type SubscriberImportOptions = { publicationIds: string[]; updateExisting: boolean; resubscribe: boolean };
export type SubscriberImportReport = { total: number; created: number; updated: number; skipped: number; failed: number; failures: { line: number; email: string; error: string }[] };

export { parseWorkbook, MAX_IMPORT_ROWS };
export type { ParsedWorkbook };

/** What the columns are most likely to be, so the operator corrects rather than fills in. */
export function guessSubscriberMapping(header: string[]): SubscriberMapping {
  const normalised = header.map(normaliseForMatch);
  const used = new Set<number>();
  const email = guessColumn(normalised, ["email", "e mail", "mail", "courriel", "adresse"], used);
  if (email !== null) used.add(email);
  const firstName = guessColumn(normalised, ["first name", "firstname", "prenom", "given name"], used);
  if (firstName !== null) used.add(firstName);
  /*
   * "Prénom" and "Nom" are one pair, not a first name and a whole name.
   *
   * A bare "Nom" column beside a "Prénom" is the surname — it is how every French list is written
   * — and reading it as the full name gave four hundred readers a first name of "Dupont" and no
   * surname at all. On its own, with no first-name column beside it, "Nom" does mean the whole
   * name, which is why the keyword only moves across when there is a "Prénom" to pair it with.
   */
  const surnameWords = ["last name", "lastname", "surname", "nom de famille", "family name"];
  const lastName = guessColumn(normalised, firstName !== null ? [...surnameWords, "nom", "name"] : surnameWords, used);
  if (lastName !== null) used.add(lastName);
  const fullName = guessColumn(normalised, ["full name", "nom complet", "name", "nom", "contact"], used);
  if (fullName !== null) used.add(fullName);
  const locale = guessColumn(normalised, ["language", "langue", "locale"], used);
  const mode: SubscriberMapping["mode"] = firstName !== null && lastName !== null ? "separate" : fullName !== null ? "fullName" : "separate";
  return { mode, email, firstName, lastName, fullName, locale };
}

function cell(row: string[], index: number | null): string {
  return index === null ? "" : (row[index] ?? "").trim();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Resolve and check every row against the mapping and the list as it stands — without writing. */
export function mapAndValidateSubscribers(input: { rows: string[][]; mapping: SubscriberMapping; existing: { email: string; status: string }[]; options: Pick<SubscriberImportOptions, "updateExisting" | "resubscribe"> }): SubscriberPreview {
  const byEmail = new Map(input.existing.map((row) => [row.email.trim().toLowerCase(), row.status]));
  const seen = new Set<string>();
  const rows: SubscriberPreviewRow[] = [];
  const summary = { total: input.rows.length, toCreate: 0, toUpdate: 0, toSkip: 0, invalid: 0, duplicates: 0 };

  input.rows.forEach((raw, index) => {
    const line = index + 2; // The header is row 1, so this is the number the spreadsheet shows.
    const email = cell(raw, input.mapping.email).toLowerCase();
    const notes: string[] = [];
    let firstName = cell(raw, input.mapping.firstName);
    let lastName = cell(raw, input.mapping.lastName);
    if (input.mapping.mode === "fullName") {
      const split = splitFullName(cell(raw, input.mapping.fullName));
      firstName = split.firstName;
      lastName = split.lastName;
    }
    const localeCell = normaliseForMatch(cell(raw, input.mapping.locale));
    const locale: "en" | "fr" = localeCell.startsWith("fr") ? "fr" : "en";

    let status: SubscriberPreviewRow["status"] = "create";
    if (!EMAIL.test(email)) {
      status = "skip";
      notes.push("Not an email address");
      summary.invalid += 1;
    } else if (seen.has(email)) {
      status = "skip";
      notes.push("Twice in this file");
      summary.duplicates += 1;
    } else {
      seen.add(email);
      const already = byEmail.get(email);
      if (already) {
        if (already === "UNSUBSCRIBED" && !input.options.resubscribe) {
          status = "skip";
          notes.push("Unsubscribed — left alone");
        } else if (!input.options.updateExisting) {
          status = "skip";
          notes.push("Already on the list");
        } else {
          status = "update";
          notes.push("Already on the list");
        }
      }
    }
    if (status === "create") summary.toCreate += 1;
    else if (status === "update") summary.toUpdate += 1;
    else summary.toSkip += 1;
    rows.push({ line, email, firstName, lastName, locale, status, notes });
  });

  return { rows, summary };
}

/** Write what the preview said would be written, one row at a time so one bad row is one failure. */
export async function commitSubscriberImport(
  organizationId: string,
  input: { rows: string[][]; mapping: SubscriberMapping; options: SubscriberImportOptions },
  userId?: string | null,
): Promise<SubscriberImportReport> {
  const existing = await db.select({ email: s.subscribers.email, status: s.subscribers.status }).from(s.subscribers).where(eq(s.subscribers.organizationId, organizationId));
  const preview = mapAndValidateSubscribers({ rows: input.rows, mapping: input.mapping, existing, options: input.options });
  const report: SubscriberImportReport = { total: preview.rows.length, created: 0, updated: 0, skipped: 0, failed: 0, failures: [] };

  for (const row of preview.rows) {
    if (row.status === "skip") {
      report.skipped += 1;
      continue;
    }
    try {
      const outcome = await addSubscriberByHand(
        organizationId,
        { email: row.email, firstName: row.firstName, lastName: row.lastName, locale: row.locale, publicationIds: input.options.publicationIds, resubscribe: input.options.resubscribe },
        userId,
      );
      if (outcome.skipped) report.skipped += 1;
      else if (outcome.created) report.created += 1;
      else report.updated += 1;
    } catch (err) {
      report.failed += 1;
      report.failures.push({ line: row.line, email: row.email, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  await audit({ action: "subscriber.imported", organizationId, userId, metadata: { created: report.created, updated: report.updated, skipped: report.skipped, failed: report.failed } });
  return report;
}
