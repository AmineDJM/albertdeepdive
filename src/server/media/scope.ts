import { eq, isNull, type SQL } from "drizzle-orm";
import * as s from "@/server/db/schema";

/**
 * One workspace's library, for the comparisons that look across pictures.
 *
 * Duplicate detection and "similar pictures" compare a picture with others by fingerprint. Without
 * a bound they compared it with every picture on the platform, so a customer's upload could be
 * marked a duplicate of somebody else's and their picture page listed another customer's files by
 * name. A picture is compared with its own workspace's, and nobody else's — the unclaimed rows of an
 * install that predates workspaces only with each other.
 */
export function inLibraryOf(organizationId: string | null | undefined): SQL {
  return organizationId ? eq(s.mediaAssets.organizationId, organizationId) : isNull(s.mediaAssets.organizationId);
}
