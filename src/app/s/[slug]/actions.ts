"use server";

import { headers } from "next/headers";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { publicationBySubscribeSlug, subscribe } from "@/server/subscribers/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { translator } from "@/lib/i18n";

export type SubscribeState = { message: string };

/**
 * Public, unauthenticated. The reply is the same whether the address was new, already pending or
 * already subscribed: "check your inbox". Anything more specific would let a stranger use the form
 * to find out who reads a publication.
 */
export async function subscribeAction(_prev: ActionResult<SubscribeState> | null, formData: FormData): Promise<ActionResult<SubscribeState>> {
  try {
    const slug = String(formData.get("slug") ?? "");
    const publication = await publicationBySubscribeSlug(slug);
    // Same answer for an unknown slug as for a real one: a stranger learns nothing either way.
    if (!publication) return ok({ message: translator("en")("subscribe.checkInbox") });
    const t = translator(publication.language);

    const h = await headers();
    const result = await subscribe(
      publication.id,
      {
        email: String(formData.get("email") ?? ""),
        firstName: String(formData.get("firstName") ?? "") || undefined,
        locale: publication.language === "fr" ? "fr" : "en",
      },
      { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"), source: "subscribe_page" },
    );

    if (result.status === "confirmation_sent" && result.confirmToken) {
      const url = `${env.NEXT_PUBLIC_APP_URL}/s/confirm/${result.confirmToken}`;
      await sendEmail({
        to: String(formData.get("email") ?? "").trim().toLowerCase(),
        subject: t("editionEmail.confirmSubject", { publication: publication.name }),
        template: "subscription_confirm",
        organizationId: publication.organizationId,
        layout: {
          appName: publication.organization?.name ?? publication.name,
          kicker: publication.name,
          title: t("editionEmail.confirmTitle"),
          preheader: t("editionEmail.confirmSubject", { publication: publication.name }),
          blocks: [
            { type: "paragraph", text: t("editionEmail.confirmBody", { publication: publication.name }) },
            { type: "paragraph", text: t("editionEmail.confirmIgnore") },
          ],
          cta: { label: t("editionEmail.confirmCta"), url },
          footer: publication.organization?.name ?? undefined,
        },
      });
    }

    return ok({ message: t("subscribe.checkInbox") });
  } catch (err) {
    return toActionFailure(err);
  }
}
