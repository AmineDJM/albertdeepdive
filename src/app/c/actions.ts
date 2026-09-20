"use server";

import { joinAsContributor, publicJoinShelf, publicationByJoinSlug } from "@/server/contributors/join";
import { ok, toActionFailure, ValidationError, type ActionResult } from "@/lib/action-result";
import { translator } from "@/lib/i18n";

export type JoinState = { message: string };

/**
 * Public, unauthenticated: somebody offering to write.
 *
 * The reply says the same thing whether the address was already known or not — a form that
 * answered "you are already a contributor" would be a way of finding out who writes for a title.
 */
export async function joinAction(_prev: ActionResult<JoinState> | null, formData: FormData): Promise<ActionResult<JoinState>> {
  try {
    const slug = String(formData.get("slug") ?? "");
    const orgSlug = String(formData.get("orgSlug") ?? "");
    const offered = slug ? [await publicationByJoinSlug(slug)].filter((publication) => publication !== null) : ((await publicJoinShelf(orgSlug))?.publications ?? []);
    if (!offered.length) return ok({ message: translator("fr")("join.done") });

    const allowed = new Set(offered.map((publication) => publication.id));
    const chosen = formData.getAll("publicationIds").map(String).filter((id) => allowed.has(id));
    const publicationIds = chosen.length ? chosen : offered.length === 1 ? [offered[0].id] : [];
    const language = offered.find((publication) => publicationIds.includes(publication.id))?.language ?? offered[0].language;
    const t = translator(language);
    if (!publicationIds.length) throw new ValidationError(t("join.pickAtLeastOne"));

    await joinAsContributor({
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      email: String(formData.get("email") ?? ""),
      organisationName: String(formData.get("organisationName") ?? "") || undefined,
      preferredLanguage: language === "fr" ? "fr" : "en",
      publicationIds,
    });
    return ok({ message: t("join.done") });
  } catch (err) {
    return toActionFailure(err);
  }
}
