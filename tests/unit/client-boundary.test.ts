import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

/**
 * A server component may render a client component. It may not call one's functions.
 *
 * This is the one mistake in a Next application that every check misses: the types line up, the
 * build succeeds, and the page throws on the first request with "Attempted to call x() from the
 * server but x is on the client". It happened here — a screen read a date helper that lived beside
 * the form that used it — and it reached a green build and a green test suite before a browser saw
 * it.
 *
 * The rule is the one React enforces at runtime: from a server file, a `"use client"` module can
 * only give you components. So a capitalised import is allowed and a lowercase one is not, which
 * is exactly the convention the codebase already follows. A helper both sides want belongs in a
 * plain module that neither side has to guess about.
 */

const SRC = resolve(import.meta.dirname, "../../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const files = walk(SRC);
const source = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));

function isClient(path: string): boolean {
  const text = source.get(path);
  return Boolean(text && /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(text));
}

/** The file an import specifier names, with the extensions and index files Node would try. */
function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (source.has(candidate)) return candidate;
  }
  return null;
}

describe("the client boundary", () => {
  it("never has a server file calling into a client module", () => {
    const offences: string[] = [];
    for (const [path, text] of source) {
      if (isClient(path)) continue;
      // Named imports only: a default import of a client component is a component by definition.
      for (const match of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
        const [, typeOnly, bindings, specifier] = match;
        if (typeOnly) continue;
        const target = resolveImport(path, specifier);
        if (!target || !isClient(target)) continue;
        for (const binding of bindings.split(",")) {
          const name = binding.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
          if (!name || binding.trim().startsWith("type ")) continue;
          if (!/^[A-Z]/.test(name)) offences.push(`${path.slice(SRC.length + 1)} imports ${name} from ${specifier}`);
        }
      }
    }
    expect(offences, `a server file may only import components from a "use client" module:\n${offences.join("\n")}`).toEqual([]);
  });
});
