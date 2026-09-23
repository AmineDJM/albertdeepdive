import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { EmailMasthead } from "./template";
import { newsletterLook } from "@/server/publications/brand";

/**
 * Whose name goes at the top of an email.
 *
 * Resolved here rather than at each of the thirty places an email is built, because the ones that
 * forget are exactly the ones that matter: a builder that omits it does not fail, it silently signs
 * a customer's message with the platform's logo, and nobody notices until a contributor asks who
 * Briefly is. Every customer-facing send already carries an edition or an organisation, so the
 * sender can be worked out from what the call already says.
 *
 * Returning null is a real answer, not a failure: it means nothing about this email belongs to a
 * workspace — a receipt, a domain to verify, a mailbox test — and Briefly signs those itself.
 */
export async function resolveMasthead(scope: {
  organizationId?: string | null;
  editionId?: string | null;
  /** The newsletter the message is about, when it is about one and no edition says so. */
  publicationId?: string | null;
  /** The publication's name, when the caller already knows it. */
  name?: string | null;
}): Promise<EmailMasthead | null> {
  let organizationId = scope.organizationId ?? null;
  let publicationId = scope.publicationId ?? null;
  const name = scope.name?.trim() || null;

  if (scope.editionId && (!organizationId || !publicationId)) {
    const edition = await db.query.editions.findFirst({
      where: eq(s.editions.id, scope.editionId),
      columns: { organizationId: true, publicationId: true },
    });
    organizationId ??= edition?.organizationId ?? null;
    publicationId ??= edition?.publicationId ?? null;
  }
  if (publicationId && !organizationId) {
    organizationId = (await db.query.publications.findFirst({ where: eq(s.publications.id, publicationId), columns: { organizationId: true } }))?.organizationId ?? null;
  }

  if (!organizationId) return name ? { name } : null;
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { id: true } });
  if (!organization) return name ? { name } : null;

  // The newsletter signs its own mail, in its own look when it has one; the workspace signs what
  // is not a newsletter's.
  const look = await newsletterLook({ organizationId, publicationId });
  return { name: name ?? look.name, logoUrl: look.logoUrl, colour: look.colour };
}
