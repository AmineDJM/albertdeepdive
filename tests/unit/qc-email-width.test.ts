import { describe, expect, it } from "vitest";
import { widestFixedWidth } from "@/server/qc/checks/delivery";

/**
 * Whether an email scrolls sideways on a phone.
 *
 * The measurement that matters is the width that survives the client's own arithmetic, not the
 * widest number in the file. A 600 px table carrying `max-width:100%` is the standard responsive
 * email — 600 on a desktop, 375 on a phone — and counting it as 600 reports a defect on every
 * well-built newsletter ever sent, which is how a quality gate teaches people to ignore it.
 */
describe("the widest thing a phone cannot shrink", () => {
  it("does not count a fluid container that shrinks to the screen", () => {
    expect(widestFixedWidth('<table width="600" style="width:600px;max-width:100%;"><tr><td>Hello</td></tr></table>')).toBe(0);
    expect(widestFixedWidth('<img src="x.jpg" width="544" style="width:100%;max-width:544px;">')).toBe(0);
  });

  it("counts a width nothing will shrink", () => {
    expect(widestFixedWidth('<td width="700">Too wide</td>')).toBe(700);
    expect(widestFixedWidth('<div style="width:800px;">Too wide</div>')).toBe(800);
  });

  it("ignores markup only Outlook on a desktop will ever draw", () => {
    const html = '<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table width="600" style="max-width:100%;"><tr><td>Hi</td></tr></table><!--[if mso]></td></tr></table><![endif]-->';
    expect(widestFixedWidth(html)).toBe(0);
  });

  it("still measures what every client except Outlook is shown", () => {
    const html = '<!--[if !mso]><!-- --><div style="width:900px;">A button</div><!--<![endif]-->';
    expect(widestFixedWidth(html)).toBe(900);
  });

  it("takes the widest of several, and ignores a page-sized number that is not a layout", () => {
    expect(widestFixedWidth('<td width="420">a</td><td width="500">b</td><img width="9000">')).toBe(500);
  });
});
