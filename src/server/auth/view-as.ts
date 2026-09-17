import { cookies } from "next/headers";
import { signPayload, verifyPayload } from "./tokens";
import { env } from "@/server/env";
import { ROLES, type Role } from "@/lib/auth/permissions";

export const VIEW_AS_COOKIE = "briefly_view_as";

/**
 * Seeing the product as a customer sees it.
 *
 * Support answers questions about screens the person answering cannot open. Briefly already lets
 * platform staff enter any workspace; this adds the other half — entering it *as a role*, so a
 * question about what an editor can see is answered by looking rather than by reasoning about a
 * permissions table.
 *
 * Three rules make it safe to have at all:
 *
 *  1. It only ever narrows. The cookie names a role, and it is honoured only when the real session
 *     belongs to platform staff, who already hold every permission. There is no path by which this
 *     grants anything.
 *  2. The real identity does not change. `getCurrentUser` swaps the role and nothing else, so the
 *     audit trail records who actually did it, not who they were pretending to be. A support session
 *     that edits a customer's edition leaves that person's name on the change.
 *  3. It is signed and it expires. Not because an unsigned cookie could currently escalate — it
 *     cannot — but because a value read as a role should never be one a browser can simply write.
 */

const TTL_SECONDS = 60 * 60 * 4;

export type ViewAs = {
  /** The role to pretend to hold. */
  role: Role;
  /** Whose view this is, when a specific person was chosen rather than a bare role. */
  userId?: string;
  userName?: string;
  /** The workspace it was started from, so leaving returns somewhere sensible. */
  organizationId?: string;
};

type Payload = ViewAs & { iat: number };

export async function startViewAs(view: ViewAs) {
  const store = await cookies();
  store.set(VIEW_AS_COOKIE, signPayload(view, TTL_SECONDS), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function stopViewAs() {
  const store = await cookies();
  store.set(VIEW_AS_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

/**
 * The role being simulated, if any.
 *
 * Returns null rather than throwing when the cookie is missing, expired or nonsense: a support
 * session that quietly ends is better than one that locks somebody out of their own console.
 */
export async function readViewAs(): Promise<ViewAs | null> {
  const store = await cookies().catch(() => null);
  const raw = store?.get(VIEW_AS_COOKIE)?.value;
  if (!raw) return null;
  const payload = verifyPayload<Payload>(raw);
  if (!payload || !ROLES.includes(payload.role)) return null;
  return { role: payload.role, userId: payload.userId, userName: payload.userName, organizationId: payload.organizationId };
}
