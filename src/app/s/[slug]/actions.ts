"use server";

import { headers } from "next/headers";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { publicationBySubscribeSlug, subscribe } from "@/server/subscribers/service";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

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
    if (!publication) return ok({ message: "Check your inbox to confirm your subscription." });

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
        subject: `Confirm your subscription to ${publication.name}`,
        template: "subscription_confirm",
        organizationId: publication.organizationId,
        layout: {
          appName: publication.organization?.name ?? publication.name,
          kicker: publication.name,
          title: "One more step",
          preheader: `Confirm your subscription to ${publication.name}.`,
          blocks: [
            { type: "paragraph", text: `Someone — we hope you — asked to receive ${publication.name}. Confirm below and you will get the next edition.` },
            { type: "paragraph", text: "If this wasn't you, ignore this email. Nothing will be sent." },
          ],
          cta: { label: "Confirm subscription", url },
          footer: publication.organization?.name ?? undefined,
        },
      });
    }

    return ok({ message: "Check your inbox to confirm your subscription." });
  } catch (err) {
    return toActionFailure(err);
  }
}
