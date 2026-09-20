"use server";

import { headers } from "next/headers";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { publicShelf, subscribeToMany } from "@/server/subscribers/service";
import { ok, toActionFailure, ValidationError, type ActionResult } from "@/lib/action-result";
import { translator } from "@/lib/i18n";

export type ShelfState = { message: string };

/**
 * Public, unauthenticated, and deliberately vague about who is already on a list.
 *
 * One address and however many titles were ticked: one row, one confirmation email, one click.
 * The reader is told to check their inbox whether or not anything was created, exactly as the
 * single-title form does.
 */
export async function subscribeShelfAction(_prev: ActionResult<ShelfState> | null, formData: FormData): Promise<ActionResult<ShelfState>> {
  try {
    const orgSlug = String(formData.get("orgSlug") ?? "");
    const shelf = await publicShelf(orgSlug);
    if (!shelf) return ok({ message: translator("en")("subscribe.checkInbox") });

    // Only the ids this shelf actually offers: a hidden field is not a promise.
    const offered = new Set(shelf.publications.map((publication) => publication.id));
    const chosen = formData.getAll("publicationIds").map(String).filter((id) => offered.has(id));
    const language = shelf.publications.find((publication) => chosen.includes(publication.id))?.language ?? shelf.publications[0].language;
    const t = translator(language);
    if (!chosen.length) throw new ValidationError(t("subscribe.pickAtLeastOne"));

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
    const email = String(formData.get("email") ?? "");
    const firstName = String(formData.get("firstName") ?? "") || undefined;
    const locale = language === "fr" ? ("fr" as const) : ("en" as const);

    const result = await subscribeToMany(chosen, { email, firstName, locale }, { ip, source: "shelf_page" });
    if (result.status === "confirmation_sent" && result.confirmToken) {
      const names = shelf.publications.filter((publication) => chosen.includes(publication.id)).map((publication) => publication.name);
      const url = `${env.NEXT_PUBLIC_APP_URL}/s/confirm/${result.confirmToken}`;
      await sendEmail({
        to: email.trim().toLowerCase(),
        subject: t("editionEmail.confirmSubject", { publication: names.join(", ") }),
        template: "subscription_confirm",
        organizationId: shelf.organization.id,
        layout: {
          appName: shelf.organization.name,
          kicker: names.join(" · "),
          title: t("editionEmail.confirmTitle"),
          preheader: t("editionEmail.confirmSubject", { publication: names.join(", ") }),
          blocks: [
            { type: "paragraph", text: t("editionEmail.confirmBody", { publication: names.join(", ") }) },
            { type: "paragraph", text: t("editionEmail.confirmIgnore") },
          ],
          cta: { label: t("editionEmail.confirmCta"), url },
          footer: shelf.organization.name,
        },
      });
    }
    return ok({ message: t("subscribe.checkInbox") });
  } catch (err) {
    return toActionFailure(err);
  }
}
