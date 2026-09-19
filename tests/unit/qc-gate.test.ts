import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BLOCKING, HARD_BLOCKING } from "@/server/qc/types";
import { ALL_METRICS } from "@/server/qc/spec";

/**
 * The one rule the whole engine is worth nothing without: nobody gets to approve a measurement.
 *
 * Every quality system that has ever been quietly disabled was disabled the same way — not by
 * deleting the checks, but by adding a flag. A `force`, a `skipPreflight`, an "override with a
 * reason" that reviewers learn to click. The editorial gates in this product have exactly such an
 * override, and correctly so: whether an issue is *finished* is a judgement, and a judgement can be
 * overruled by somebody senior enough to own it.
 *
 * Preflight is not a judgement. A clipped word is clipped, a refused photograph is refused, and a
 * PDF page a press will reject is rejected whoever signs the form. So these guards are written
 * against the source rather than against behaviour: behaviour can be restored after a test is
 * changed, but the absence of a bypass is visible in the diff that adds one.
 */

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("the gate cannot be talked round", () => {
  it("offers no way to skip, force or override a blocking finding", () => {
    for (const file of [
      ["src", "server", "qc", "index.ts"],
      ["src", "server", "qc", "engine.ts"],
      ["src", "server", "publication", "preflight.ts"],
    ]) {
      const source = read(...file);
      expect(source, `${file.join("/")} must not offer a bypass`).not.toMatch(/\b(skipQc|forceQc|bypassQc|ignoreFindings|overrideQc|allowBlocking|qcOverride)\b/);
      // `force` at all, in these three files, would be a bypass by another name.
      expect(source).not.toMatch(/\bforce\s*[?:]/);
    }
  });

  it("runs preflight before an issue can become published, not after", () => {
    const source = read("src", "server", "publication", "versions.ts");
    const gate = source.indexOf("requireQcPass");
    const publish = source.indexOf('status: "PUBLISHED"');
    expect(gate, "publishEdition must call the gate").toBeGreaterThan(0);
    expect(publish).toBeGreaterThan(0);
    expect(gate, "the gate is passed before the edition is marked published").toBeLessThan(publish);
  });

  it("only lets an artefact become READY once preflight has found nothing blocking", () => {
    const source = read("src", "server", "publication", "versions.ts");
    const preflight = source.indexOf("runPreflight(");
    const ready = source.indexOf('status: "READY"');
    expect(preflight).toBeGreaterThan(0);
    expect(ready).toBeGreaterThan(0);
    expect(preflight, "measured before it is called ready").toBeLessThan(ready);
    expect(source).toContain("preflight.blocking.length");
  });

  it("throws rather than returning a boolean somebody can forget to read", () => {
    const source = read("src", "server", "qc", "index.ts");
    expect(source).toMatch(/export async function requireQcPass[\s\S]*throw new QcBlockedError/);
    expect(source).toMatch(/export async function requireRenderable[\s\S]*throw new QcBlockedError/);
  });

  it("keeps the two blocking sets honest: what stops a draft is a subset of what stops a release", () => {
    for (const severity of HARD_BLOCKING) expect(BLOCKING).toContain(severity);
    expect(BLOCKING.length).toBeGreaterThan(HARD_BLOCKING.length);
  });

  it("gives every rule that can block a way to be understood rather than only obeyed", () => {
    // A blocking rule whose method nobody can read is a rule an operator can only work around.
    for (const metric of ALL_METRICS.filter((each) => BLOCKING.includes(each.severity))) {
      expect(metric.method.length, `${metric.id} must say how it is measured`).toBeGreaterThan(30);
      expect(metric.origin, `${metric.id} must say where its number comes from`).toBeTruthy();
    }
  });
});
