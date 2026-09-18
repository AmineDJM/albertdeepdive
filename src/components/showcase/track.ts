"use client";

/**
 * Tell the server what happened, and never make the visitor wait for it.
 *
 * `sendBeacon` survives the page being left, which is exactly the moment the two events that matter
 * fire: opening a publication and clicking through to sign up. When it is unavailable the fetch is
 * fire-and-forget with `keepalive`, and when both fail nothing happens at all, which is the correct
 * outcome for a counter.
 */
export type ShowcaseEventKind = "COLLECTION_VIEW" | "GALLERY_VIEW" | "ITEM_OPEN" | "SIGNUP_CLICK";

export function track(kind: ShowcaseEventKind, ids: { collectionId?: string | null; editionId?: string | null } = {}) {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ kind, ...ids });
  try {
    if (navigator.sendBeacon?.(`/api/public/showcase`, new Blob([body], { type: "application/json" }))) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch("/api/public/showcase", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
}
