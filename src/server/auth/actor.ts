import { AsyncLocalStorage } from "node:async_hooks";
import { getCurrentUser } from "./session";

/**
 * Who is doing this.
 *
 * Inside a request the answer is the session. Inside a job there is no session, but there is the
 * person who queued the job, and what it spends should be written to their name rather than to
 * nobody's. The runner declares them here, ambiently, and anything that records a cost — an AI
 * call, a generated picture — asks `currentActorId()` without knowing which of the two it is in.
 */
const actor = new AsyncLocalStorage<string | null>();

export function runAsActor<T>(userId: string | null | undefined, fn: () => Promise<T> | T): Promise<T> | T {
  return actor.run(userId ?? null, fn);
}

export function ambientActorId(): string | null {
  return actor.getStore() ?? null;
}

/** The declared actor of a job, else the signed-in person, else nobody — never a throw. */
export async function currentActorId(): Promise<string | null> {
  const declared = ambientActorId();
  if (declared) return declared;
  try {
    return (await getCurrentUser())?.id ?? null;
  } catch {
    return null;
  }
}
