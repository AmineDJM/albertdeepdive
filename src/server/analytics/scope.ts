import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "@/server/db/schema";
import { db } from "@/server/db/client";
import { currentOrganizationId } from "@/server/tenancy/context";
import { NotFoundError } from "@/lib/action-result";

/**
 * The workspace every customer figure is counted inside.
 *
 * This type exists because the old one did not have a workspace in it at all. Analytics was
 * "scoped by an edition, or by all editions", and "all editions" meant every edition on the
 * platform: pick no edition on Albert School's Analytics page and the submission trend, the
 * conversion funnel, the rights table and the contributor league table counted Adventum's rows
 * too. Nobody had to guess an id; the default view leaked.
 *
 * So `organizationId` is required and non-optional, and it is resolved from the session by
 * `tenantScope()` — never read from a query string, a body or a header. A reader that compiles is
 * a reader that is scoped, which is the only kind of guarantee worth having here: the previous
 * shape relied on every author of every future query remembering to add a filter, and fifteen
 * queries in, one of them had not.
 *
 * The admin console reaches the same readers through `workspaceScopeForAdmin`, which is a separate
 * door with its own authorization. Passing "no workspace" is not a way in, because there is no
 * value of this type that means that.
 */
export type TenantScope = {
  readonly organizationId: string;
  readonly editionId: string | null;
  readonly from: Date | null;
  readonly to: Date | null;
};

/** A window, before a workspace is attached to it. */
export type AnalyticsWindow = { from: Date | null; to: Date | null };

/**
 * `column = <this workspace>`, for the tables that carry the id themselves.
 *
 * Exact equality rather than the lenient `scoped()` helper used elsewhere: that one also admits
 * rows with a null `organization_id`, which is right for a list of somebody's own pictures written
 * before multi-tenancy and wrong here, where an unclaimed row would be added to *every* customer's
 * totals. A figure nobody owns belongs in nobody's count.
 */
export function ownedBy(column: AnyPgColumn, scope: TenantScope): SQL {
  return eq(column, scope.organizationId);
}

/**
 * `column in (the editions this workspace owns)`, for the tables that hang off an edition.
 *
 * Submissions, stories, articles, requests, clusters and sections have no `organization_id` of
 * their own; their edition does, and it is `not null` on all of them. When an edition is picked the
 * equality is ANDed *on top of* the ownership test rather than replacing it, so an id belonging to
 * another customer returns nothing instead of returning their figures — the query is safe even if
 * a caller ever skips `tenantScope()`.
 *
 * The subquery names its table and columns literally, under its own alias, rather than through the
 * schema objects. Drizzle's relational query builder rewrites interpolated columns to the alias of
 * the table being queried, so `${s.editions.organizationId}` inside a `db.query.x.findFirst` came
 * out as `"x"."organization_id"` — a column that does not exist, and would have been a column that
 * does on any table that happens to have one. An alias-free subquery cannot be re-aliased.
 */
export function inOwnEditions(editionColumn: AnyPgColumn, scope: TenantScope): SQL {
  const owned = sql`${editionColumn} in (select analytics_scope_e.id from editions analytics_scope_e where analytics_scope_e.organization_id = ${scope.organizationId})`;
  return scope.editionId ? and(owned, eq(editionColumn, scope.editionId))! : owned;
}

/** The picked edition, for a table already constrained by `ownedBy`. Null-safe on nullable columns. */
export function pickedEdition(editionColumn: AnyPgColumn, scope: TenantScope): SQL | undefined {
  return scope.editionId ? eq(editionColumn, scope.editionId) : undefined;
}

/**
 * An edition id from the browser, checked against the workspace that asked.
 *
 * Returns null for "no edition picked", and throws for one that belongs to somebody else. The
 * throw matters more than the filter: a customer sending another customer's edition id must be
 * told it does not exist, not quietly shown all-editions figures — and certainly not theirs.
 */
export async function verifyEdition(editionId: string | null | undefined, organizationId: string): Promise<string | null> {
  if (!editionId) return null;
  const row = await db.query.editions.findFirst({
    where: eq(s.editions.id, editionId),
    columns: { id: true, organizationId: true },
  });
  if (!row || row.organizationId !== organizationId) throw new NotFoundError("Edition");
  return row.id;
}

/**
 * The scope for a customer looking at their own Analytics page.
 *
 * The workspace comes from the session. The edition, which does come from the URL, is verified
 * against it before it is allowed anywhere near a query.
 */
export async function tenantScope(window: AnalyticsWindow, editionId?: string | null): Promise<TenantScope> {
  const organizationId = await currentOrganizationId();
  return { organizationId, editionId: await verifyEdition(editionId, organizationId), from: window.from, to: window.to };
}

/**
 * The same scope, for one named workspace, on behalf of platform staff.
 *
 * Deliberately a different function with a different name: the console needs to read a customer's
 * figures, and the safe way to give it that is an explicit id it had to go and find, not a tenant
 * reader called with the workspace left out. Authorization is the caller's — every use sits behind
 * `requirePermission("platform:view")` — and this asserts the workspace exists so a bad id in an
 * admin URL is a 404 rather than an empty page that looks like a customer doing nothing.
 */
export async function workspaceScopeForAdmin(organizationId: string, window: AnalyticsWindow, editionId?: string | null): Promise<TenantScope> {
  const org = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { id: true } });
  if (!org) throw new NotFoundError("Workspace");
  return { organizationId: org.id, editionId: await verifyEdition(editionId, org.id), from: window.from, to: window.to };
}
