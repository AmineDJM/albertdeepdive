import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { EmailMasthead } from "./template";

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
  /** The publication's name, when the caller already knows it. */
  name?: string | null;
}): Promise<EmailMasthead | null> {
  let organizationId = scope.organizationId ?? null;
  let name = scope.name?.trim() || null;

  if (scope.editionId && (!organizationId || !name)) {
    const edition = await db.query.editions.findFirst({
      where: eq(s.editions.id, scope.editionId),
      columns: { organizationId: true, publicationId: true },
    });
    organizationId ??= edition?.organizationId ?? null;
    if (!name && edition?.publicationId) {
      const publication = await db.query.publications.findFirst({
        where: eq(s.publications.id, edition.publicationId),
        columns: { name: true },
      });
      name = publication?.name?.trim() || null;
    }
  }

  if (!organizationId) return name ? { name } : null;

  const organization = await db.query.organizations.findFirst({
    where: eq(s.organizations.id, organizationId),
    columns: { name: true, logoUrl: true, brandColours: true },
  });
  if (!organization) return name ? { name } : null;

  const colours = (organization.brandColours ?? {}) as { primary?: string };
  return {
    // The publication signs its own mail; the workspace signs what is not a publication's.
    name: name ?? organization.name,
    logoUrl: organization.logoUrl,
    colour: colours.primary ?? null,
  };
}
