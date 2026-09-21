import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getSetting } from "@/server/campaigns/settings";
import { mastheadSchema, DEFAULT_MASTHEAD } from "@/server/settings/schemas";

/**
 * What this newsletter is called — the one answer every surface must read.
 *
 * It had no single answer, which is how a workspace could create a newsletter called "IA School
 * Newsletter" and watch it introduce itself to contributors as Albert's Deep Dive. The name was
 * written out by hand in the invitation subject, in the kicker, in the footer, on the cover, on
 * every public contributor screen, in the information-request emails, in the PDF colophon and in
 * the prompt that tells the model whose newspaper it is writing. Seventeen places, each of them
 * correct for exactly one customer.
 *
 * The title owns its name. A newsletter is the thing that has an audience, a look and a masthead,
 * so `publications.name` is authoritative and renaming it renames the publication everywhere a
 * reader can see. The workspace masthead setting stays as the answer for an edition that belongs
 * to no title yet — Briefly's own back catalogue has some — and only then.
 *
 * Deliberately not memoised across requests: somebody renaming their newsletter must see the new
 * name on the next screen, not after a deploy.
 */

export type Newsletter = { name: string; tagline: string | null };

/** The workspace's fallback, for an edition with no title behind it. */
export async function workspaceMasthead(): Promise<Newsletter> {
  const masthead = await getSetting("masthead", DEFAULT_MASTHEAD, mastheadSchema);
  return { name: masthead.title || DEFAULT_MASTHEAD.title, tagline: masthead.tagline || null };
}

/** The name of the title an edition belongs to, or the workspace's masthead when it has none. */
export async function newsletterFor(publicationId: string | null | undefined): Promise<Newsletter> {
  if (publicationId) {
    const row = await db.query.publications.findFirst({ where: eq(s.publications.id, publicationId), columns: { name: true, description: true } });
    if (row?.name) return { name: row.name, tagline: row.description?.trim() || null };
  }
  return workspaceMasthead();
}

/** The same, from an edition id, for the callers that only hold one. */
export async function newsletterForEdition(editionId: string): Promise<Newsletter> {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), columns: { publicationId: true } });
  return newsletterFor(edition?.publicationId ?? null);
}
