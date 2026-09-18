/**
 * A partial parse, kept partial.
 *
 * zod fills a `.partial()` parse with the schema's defaults, so `{ name }` comes back with
 * `isActive: true`, `locale: "en"` and whatever else has a default — and an update built from it
 * quietly resets fields the caller never mentioned. Renaming a title reset its language; editing
 * a role reactivated a deactivated account. A default is not a change: only the keys the caller
 * actually sent may overwrite what is there.
 */
export function onlySent<T extends object>(parsed: T, raw: object): Partial<T> {
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => key in raw)) as Partial<T>;
}
