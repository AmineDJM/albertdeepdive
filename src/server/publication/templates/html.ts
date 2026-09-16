/**
 * Minimal, dependency-free HTML templating for the print renderer.
 *
 * `html\`...\`` escapes every interpolated value unless it is an `Html` instance (already rendered)
 * — arrays are concatenated, `null`/`undefined`/booleans render as nothing. Everything the print
 * pipeline emits goes through here, so untrusted article text can never break the markup.
 */

export class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

export function raw(value: string): Html {
  return new Html(value);
}

export const EMPTY = new Html("");

function render(value: unknown): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (typeof value === "number") return String(value);
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = "";
  for (let i = 0; i < strings.length; i += 1) {
    out += strings[i];
    if (i < values.length) out += render(values[i]);
  }
  return new Html(out);
}

export function join(items: readonly Html[], separator = ""): Html {
  return new Html(items.map((i) => i.value).join(separator));
}

export function when(condition: unknown, produce: () => Html): Html {
  return condition ? produce() : EMPTY;
}

/** Escapes a value for use inside a CSS `url()` / style attribute (only safe characters kept). */
export function cssUrl(url: string): string {
  return url.replace(/["'()\s\\]/g, (c) => encodeURIComponent(c));
}

/** Breaks a text with "\n\n" paragraph separators into separate paragraphs. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
