"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { ok, toActionFailure, ValidationError, type ActionResult } from "@/lib/action-result";
import {
  addSubscriberByHand,
  commitSubscriberImport,
  guessSubscriberMapping,
  mapAndValidateSubscribers,
  parseWorkbook,
  type ManualSubscriberInput,
  type SubscriberImportOptions,
  type SubscriberImportReport,
  type SubscriberMapping,
  type SubscriberPreview,
} from "@/server/subscribers/manage";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { eq } from "drizzle-orm";

const MAX_BYTES = 8 * 1024 * 1024;

export type ParsedSubscriberUpload = { sheetName: string; header: string[]; rows: string[][]; truncated: boolean; guess: SubscriberMapping };

/** One reader, added by the publisher. */
export async function addSubscriberAction(input: ManualSubscriberInput): Promise<ActionResult<{ created: boolean; skipped: string | null }>> {
  try {
    const user = await requirePermission("contributor:manage");
    const tenant = await requireTenant();
    const outcome = await addSubscriberByHand(tenant.organizationId, input, user.id);
    revalidatePath("/subscribers");
    if (outcome.skipped === "unsubscribed") return ok({ created: false, skipped: outcome.skipped }, "That address unsubscribed before. Tick “put them back” to add them again.");
    return ok({ created: outcome.created, skipped: null }, outcome.created ? "Added" : "Already on the list — updated");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Step 1 — read the file on the server and guess what its columns are. */
export async function parseSubscriberFileAction(formData: FormData): Promise<ActionResult<ParsedSubscriberUpload>> {
  try {
    await requirePermission("contributor:manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a file to import");
    if (file.size > MAX_BYTES) throw new ValidationError("That file is too large (8 MB maximum)");
    const parsed = parseWorkbook(Buffer.from(await file.arrayBuffer()));
    if (!parsed.header.length) throw new ValidationError("The first row of the sheet must name the columns");
    return ok({ ...parsed, guess: guessSubscriberMapping(parsed.header) });
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Step 2 — what would happen, row by row, if this mapping were used. Writes nothing. */
export async function previewSubscriberImportAction(input: { rows: string[][]; mapping: SubscriberMapping; options: Pick<SubscriberImportOptions, "updateExisting" | "resubscribe"> }): Promise<ActionResult<SubscriberPreview>> {
  try {
    await requirePermission("contributor:manage");
    const tenant = await requireTenant();
    if (input.mapping.email === null) throw new ValidationError("Say which column holds the email address");
    const existing = await db.select({ email: s.subscribers.email, status: s.subscribers.status }).from(s.subscribers).where(eq(s.subscribers.organizationId, tenant.organizationId));
    return ok(mapAndValidateSubscribers({ rows: input.rows, mapping: input.mapping, existing, options: input.options }));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Step 3 — write it, and say exactly what was written. */
export async function commitSubscriberImportAction(input: { rows: string[][]; mapping: SubscriberMapping; options: SubscriberImportOptions }): Promise<ActionResult<SubscriberImportReport>> {
  try {
    const user = await requirePermission("contributor:manage");
    const tenant = await requireTenant();
    if (input.mapping.email === null) throw new ValidationError("Say which column holds the email address");
    const report = await commitSubscriberImport(tenant.organizationId, input, user.id);
    revalidatePath("/subscribers");
    return ok(report, `${report.created} added · ${report.updated} updated · ${report.skipped} left alone`);
  } catch (err) {
    return toActionFailure(err);
  }
}
