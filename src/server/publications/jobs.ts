import { JOB_TYPES, registerJobHandler } from "@/server/jobs/registry";
import { applyNewsletterLook } from "./brand";

/**
 * Reading a newsletter's address in the background.
 *
 * Opening a browser on somebody's site can take twenty seconds, and nobody should wait that long
 * for a newsletter to be created. When the look was not read on the screen before saving, it is
 * read here, and the newsletter is dressed as soon as it is.
 */
registerJobHandler<{ publicationId: string; actorId?: string | null }, { ownBrand: boolean }>(JOB_TYPES.PUBLICATION_BRAND_READ, async (payload, ctx) => {
  const result = await applyNewsletterLook(payload.publicationId, { actorId: payload.actorId ?? null });
  ctx.log("newsletter look read", { publicationId: payload.publicationId, ownBrand: result.ownBrand, missing: result.reading?.missing ?? [] });
  return { ownBrand: result.ownBrand };
});
