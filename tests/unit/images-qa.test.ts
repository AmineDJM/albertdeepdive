import { describe, expect, it } from "vitest";
import { assessImage, changeRatio, variationsFor } from "@/lib/images/qa";
import type { ImageEditPlan } from "@/lib/images/types";

const plan = (extra: Partial<ImageEditPlan>): ImageEditPlan => ({ operation: "localized_edit", task: "precise_edit", change: ["x"], preserve: [], references: [], sensitivity: "HIGH", region: null, output: "raster", prompt: "x", source: "local", ...extra });
const ZERO = "0".repeat(16);
const flip = (bits: number) => ("f".repeat(Math.floor(bits / 4)) + (bits % 4 ? ["", "8", "c", "e"][bits % 4] : "")).padEnd(16, "0");
const after = (phash: string) => ({ phash, width: 1024, height: 1024 });

/**
 * Is this the picture that was asked for?
 *
 * The numbers set a floor: a "change only the plant" that changed half the frame did not do what
 * it was told, and one that changed nothing did not either. A model's reading can lower the score
 * further; it can never talk a protected subject's lost face past the floor.
 */
describe("checking a picture", () => {
  it("measures how much of the picture changed", () => {
    expect(changeRatio(ZERO, ZERO)).toBe(0);
    expect(changeRatio(ZERO, flip(32))).toBe(0.5);
    expect(changeRatio(ZERO, null)).toBeNull();
    expect(changeRatio("abc", ZERO)).toBeNull();
  });

  it("passes a surgical edit that changed a little and fails one that changed half the frame", () => {
    const good = assessImage({ plan: plan({}), before: { phash: ZERO }, after: after(flip(6)) });
    expect(good.verdict).toBe("pass");
    expect(good.issues).toEqual([]);
    const wild = assessImage({ plan: plan({}), before: { phash: ZERO }, after: after(flip(40)) });
    expect(wild.verdict).toBe("fail");
    expect(wild.issues[0]).toMatch(/Far more of the picture changed/);
    const wildButFree = assessImage({ plan: plan({ sensitivity: "MEDIUM" }), before: { phash: ZERO }, after: after(flip(40)) });
    expect(wildButFree.verdict).toBe("retry");
  });

  it("notices when nothing changed and when the answer is too small", () => {
    const same = assessImage({ plan: plan({ operation: "global_edit", sensitivity: "LOW" }), before: { phash: ZERO }, after: after(ZERO) });
    expect(same.verdict).toBe("retry");
    expect(same.issues[0]).toMatch(/Nothing seems to have changed/);
    const tiny = assessImage({ plan: plan({ operation: "generate" }), before: null, after: { phash: ZERO, width: 128, height: 128 } });
    expect(tiny.verdict).toBe("fail");
  });

  it("lets a seeing model lower the score but never lift a lost face", () => {
    const seen = assessImage({ plan: plan({}), before: { phash: ZERO }, after: after(flip(6)), vision: { adherence: 0.95, fidelity: 0.9, quality: 0.9, issues: [], unwantedChanges: [] } });
    expect(seen.method).toBe("vision");
    expect(seen.verdict).toBe("pass");
    const drifted = assessImage({ plan: plan({}), before: { phash: ZERO }, after: after(flip(6)), vision: { adherence: 1, fidelity: 0.4, quality: 1, issues: [], unwantedChanges: ["the hair"] } });
    expect(drifted.verdict).toBe("fail");
    expect(drifted.issues).toEqual(expect.arrayContaining([expect.stringMatching(/no longer clearly resembles/), expect.stringMatching(/Changed without being asked: the hair/)]));
    // The numbers' penalty is kept even when the model is happy.
    const talkedUp = assessImage({ plan: plan({}), before: { phash: ZERO }, after: after(flip(40)), vision: { adherence: 1, fidelity: 1, quality: 1, issues: [], unwantedChanges: [] } });
    expect(talkedUp.verdict).not.toBe("pass");
  });

  it("makes one candidate unless the job is uncertain and worth it", () => {
    expect(variationsFor(plan({}), null)).toBe(1);
    expect(variationsFor(plan({ operation: "generate", task: "realistic_scene" }), null)).toBe(2);
    expect(variationsFor(plan({ operation: "generate", task: "abstract" }), null)).toBe(1);
    expect(variationsFor(plan({}), 9)).toBe(4);
    expect(variationsFor(plan({ operation: "generate" }), 3)).toBe(3);
  });
});
