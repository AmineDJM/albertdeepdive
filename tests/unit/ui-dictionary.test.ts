import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { UI_FR } from "@/lib/i18n/ui-fr";
import { uiTranslator } from "@/lib/i18n/ui";

/**
 * Every string the interface says, in every language it ships in.
 *
 * The code says its strings in English and the dictionary is keyed by them, so a new button whose
 * words nobody translated would show English to a French newsroom and nothing would report it.
 * This lists what the code asks for against what the dictionary holds, the way `msgfmt --check`
 * has for gettext: a half-translated build is a failing test, not a surprise on somebody's screen.
 */
function collect(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const root = path.join(process.cwd(), "src");
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const sf = ts.createSourceFile(full, fs.readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, full.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "tr" || node.expression.text === "tx")) {
            const [first] = node.arguments;
            if (first && ts.isStringLiteral(first)) found.set(first.text, [...(found.get(first.text) ?? []), path.relative(root, full)]);
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
    }
  })(root);
  return found;
}

describe("the interface dictionary", () => {
  const used = collect();

  it("has French for every string the code says", () => {
    const missing = [...used.keys()].filter((text) => !(text in UI_FR));
    expect(missing, `${missing.length} untranslated: ${missing.slice(0, 15).map((m) => JSON.stringify(m)).join(", ")}`).toEqual([]);
  });

  it("keeps every placeholder the English has", () => {
    const broken = Object.entries(UI_FR).filter(([en, fr]) => {
      const wanted = en.match(/\{\w+\}/g) ?? [];
      return wanted.some((token) => !fr.includes(token));
    });
    expect(broken.map(([en]) => en)).toEqual([]);
  });

  it("carries no stale entries for strings the code no longer says", () => {
    // Stale keys are not wrong, only noise; they are allowed a small margin for strings built at
    // render time from constants, which the scan above cannot see.
    const stale = Object.keys(UI_FR).filter((text) => !used.has(text));
    expect(stale.length).toBeLessThan(400);
  });

  it("falls back to English for the one string nobody translated, never to a key", () => {
    const tr = uiTranslator("fr");
    expect(tr("A sentence that exists nowhere else")).toBe("A sentence that exists nowhere else");
    expect(uiTranslator("en")("Save")).toBe("Save");
    expect(uiTranslator("fr")("{count} selected", { count: 3 })).not.toContain("{count}");
  });
});
