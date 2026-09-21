/**
 * A person's handle, for the things an email address is the wrong name for.
 *
 * Handing a newsletter to somebody is the first of them. Asking an owner to type a colleague's
 * email address to do it invites the transfer going to a typo — and a typo that happens to be a
 * real address hands a publication, its subscribers and its sending reputation to a stranger. A
 * username is a name a person chooses, says out loud, and can be read back to confirm.
 *
 * The rules are the boring ones on purpose: lower case, so `Amine` and `amine` are never two
 * people; nothing that could be mistaken for an email or a URL path; and a short reserved list so
 * that `settings` never becomes somebody's handle.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/** Words the product needs for itself, or that would make a handle a lie. */
const RESERVED = new Set([
  "admin", "administrator", "api", "app", "billing", "briefly", "contact", "dashboard", "help",
  "login", "logout", "me", "new", "onboarding", "platform", "root", "settings", "signup", "staff",
  "support", "system", "team", "user", "users", "workspace", "workspaces", "null", "undefined",
]);

export type UsernameProblem = "too-short" | "too-long" | "bad-characters" | "bad-edges" | "reserved";

/** The form a username is stored in: what the person typed, reduced to its canonical spelling. */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, "");
}

/**
 * What is wrong with this handle, or null when nothing is.
 *
 * Returns the problem rather than a message, so the screen says it in the reader's language and a
 * rule and its wording can change independently.
 */
export function usernameProblem(raw: string): UsernameProblem | null {
  const value = normaliseUsername(raw);
  if (value.length < USERNAME_MIN) return "too-short";
  if (value.length > USERNAME_MAX) return "too-long";
  if (!/^[a-z0-9._-]+$/.test(value)) return "bad-characters";
  // A handle that starts or ends with punctuation reads as a typo, and two marks in a row is how
  // one handle gets mistaken for another.
  if (/^[._-]|[._-]$|[._-]{2}/.test(value)) return "bad-edges";
  if (RESERVED.has(value)) return "reserved";
  return null;
}

export function isValidUsername(raw: string): boolean {
  return usernameProblem(raw) === null;
}

/**
 * A first handle from what we already know about somebody.
 *
 * Offered, never imposed: it is what the field starts on, so claiming one is a confirmation rather
 * than an invention. Falls back to something stable-looking when a name gives nothing usable,
 * because an empty box is not a suggestion.
 */
export function suggestUsername(name: string, email: string): string {
  const clean = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, ".")
      .replace(/[._-]{2,}/g, ".")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, USERNAME_MAX)
      .replace(/[._-]+$/, "");
  for (const candidate of [clean(name.trim()), clean((email.split("@")[0] ?? "").trim())]) {
    if (isValidUsername(candidate)) return candidate;
  }
  return `person${Math.floor(Math.random() * 9000 + 1000)}`;
}
