import { type SQL, and, eq, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { NotFoundError } from "@/lib/action-result";
import { optionalOrganizationId, withoutWorkspace } from "./context";

/**
 * Query scoping helpers.
 *
 * Two rules, applied everywhere:
 *
 *  - a list is filtered by `organization_id` before anything else, so a workspace can only ever
 *    enumerate its own rows;
 *  - a row fetched by id is checked *after* loading, and a mismatch is reported as "not found"
 *    rather than "forbidden", so an id from another workspace leaks nothing — not even that it
 *    exists.
 *
 * Rows written before multi-tenancy, and rows created by background work that has no session, may
 * still carry a null `organization_id`. Those are visible to the workspace rather than to nobody:
 * the alternative is data silently disappearing from a working install. `strictScoped` opts out of
 * that leniency for code paths that must never see an unclaimed row.
 *
 * No workspace at all means one of two very different things. A background job or the CLI, running
 * outside any request, reads unscoped and reaches rows by explicit id. A *person* with no workspace
 * — platform staff on the console, a newcomer who has not created one — sees nothing: their console
 * reads customers through its own queries, never through these.
 */

/** What a signed-in person with no workspace sees: nothing, from every table. */
const NOTHING = sql`false`;

async function unscoped(extra: (SQL | undefined)[]): Promise<SQL | undefined> {
  if (await withoutWorkspace()) return NOTHING;
  return and(...extra.filter(Boolean));
}

/** `organization_id = <active org>` (or unclaimed), optionally ANDed with more conditions. */
export async function scoped(column: AnyPgColumn, ...extra: (SQL | undefined)[]): Promise<SQL | undefined> {
  const orgId = await optionalOrganizationId();
  if (!orgId) return unscoped(extra);
  return and(or(eq(column, orgId), isNull(column)), ...extra.filter(Boolean));
}

/** `organization_id = <active org>` exactly — unclaimed rows excluded. */
export async function strictScoped(column: AnyPgColumn, ...extra: (SQL | undefined)[]): Promise<SQL | undefined> {
  const orgId = await optionalOrganizationId();
  if (!orgId) return unscoped(extra);
  return and(eq(column, orgId), ...extra.filter(Boolean));
}

/**
 * Check a row loaded by id. Returns it unchanged when it belongs to the active workspace (or to
 * none), throws `NotFoundError` when it belongs to another one — or when there is no workspace to
 * belong to because a signed-in person has none.
 */
export async function guardTenant<T extends { organizationId?: string | null } | null | undefined>(row: T, label = "Record"): Promise<T> {
  if (!row) return row;
  const orgId = await optionalOrganizationId();
  if (!orgId) {
    if (await withoutWorkspace()) throw new NotFoundError(label);
    return row;
  }
  const owner = row.organizationId ?? null;
  if (owner !== null && owner !== orgId) throw new NotFoundError(label);
  return row;
}

/**
 * The organisation stamped on every row a request creates.
 *
 * A person with no workspace cannot create one of these rows at all: unstamped, it would surface in
 * every customer's newsroom as an unclaimed row, which is the one thing this file exists to prevent.
 */
export async function stampTenant<T extends Record<string, unknown>>(values: T): Promise<T & { organizationId?: string }> {
  const orgId = await optionalOrganizationId();
  if (!orgId && (await withoutWorkspace())) throw new NotFoundError("Workspace");
  return orgId ? { ...values, organizationId: orgId } : values;
}
