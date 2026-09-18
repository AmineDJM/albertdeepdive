import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";

/**
 * Which organisation a stored file belongs to, from its key alone.
 *
 * The file route used to let any signed-in user read any key. Keys are UUID-shaped, so nobody was
 * going to guess one — but "hard to guess" is not isolation: a URL copied out of one customer's page
 * worked for another customer's account, indefinitely, because the signed-in path never expired and
 * never asked whose file it was. In a product sold to organisations that is the first thing a
 * security review writes down.
 *
 * Every key the app writes starts with a prefix that names the table its owner sits in, so ownership
 * is one lookup. Anything this does not recognise is not served on the signed-in path at all: an
 * unknown prefix is a bug or an intrusion, and both are answered with 403 rather than with a file.
 *
 *   media/<asset>/…            media_assets.organization_id
 *   attachments/<submission>/… submissions → editions.organization_id
 *   publications/<edition>/…   editions.organization_id
 *   creative/<pack>/…          creative_packs.organization_id
 *
 * `creative/generated/…` and `tmp/…` are deliberately unowned. Generated grounds are abstract colour
 * fields shared across organisations by content address and are only ever read by the render job,
 * never served; temporary files are nobody's. Both return null, which the route reads as "no".
 */
export async function organizationOwning(key: string): Promise<string | null> {
  const [prefix, id] = key.split("/");
  if (!prefix || !id || !isUuid(id)) return null;

  switch (prefix) {
    case "media": {
      const row = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, id), columns: { organizationId: true } });
      return row?.organizationId ?? null;
    }
    case "attachments": {
      const row = await db
        .select({ organizationId: s.editions.organizationId })
        .from(s.submissions)
        .innerJoin(s.editions, eq(s.editions.id, s.submissions.editionId))
        .where(eq(s.submissions.id, id))
        .limit(1);
      return row[0]?.organizationId ?? null;
    }
    case "publications": {
      const row = await db.query.editions.findFirst({ where: eq(s.editions.id, id), columns: { organizationId: true } });
      return row?.organizationId ?? null;
    }
    case "creative": {
      if (id === "generated") return null;
      const row = await db.query.creativePacks.findFirst({ where: eq(s.creativePacks.id, id), columns: { organizationId: true } });
      return row?.organizationId ?? null;
    }
    default:
      return null;
  }
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
