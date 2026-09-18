/**
 * The path a request is for, carried to layouts.
 *
 * A layout does not know which page it is wrapping, and the newsroom layout needs to: someone with
 * no workspace is redirected away from the pages that need one, but not from the console or from
 * the pages about themselves. The proxy stamps the path onto the request so the layout can tell.
 */
export const PATHNAME_HEADER = "x-briefly-pathname";

/** Prefixes that have no workspace to look at: the platform console, and the person's own settings. */
const WITHOUT_WORKSPACE = ["/platform", "/settings/profile", "/settings/help"];

export function worksWithoutWorkspace(pathname: string): boolean {
  return WITHOUT_WORKSPACE.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
