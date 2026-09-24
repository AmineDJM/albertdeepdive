/**
 * Where "Back" goes after a detour.
 *
 * A link that opens a page to configure something carries `?return=` with the page it came from,
 * and that page's Back goes there. Only addresses inside Briefly are honoured — `/editions/…`, never
 * `//elsewhere.test` or `https://…` — so the parameter cannot be used to send anybody off-site.
 */
export function internalReturn(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

/** Adds `return` to an address, so the page it opens can come back here. */
export function withReturn(href: string, returnTo: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}return=${encodeURIComponent(returnTo)}`;
}
