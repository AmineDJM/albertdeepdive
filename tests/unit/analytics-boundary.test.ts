import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Whose numbers are whose.
 *
 * A customer's Analytics page showed the AI bill: cost per pipeline service, tokens per model, cost
 * per edition. Those are the operator's figures — a newsroom cannot act on them and they are not
 * theirs to act on — and putting the running cost of somebody's own subscription in front of them
 * is a strange thing to do. They belong in the Platform console, which is where they now live.
 *
 * Checked at the import boundary rather than by reading the rendered page, because that is where
 * the rule actually is: a page that cannot reach the numbers cannot show them, however it is
 * rewritten later.
 */
const CUSTOMER_ANALYTICS = join(process.cwd(), "src", "app", "(newsroom)", "analytics", "page.tsx");
const CUSTOMER_READ_MODEL = join(process.cwd(), "src", "server", "analytics", "read-insights.ts");
const PLATFORM_COSTS = join(process.cwd(), "src", "app", "(admin)", "admin", "costs", "page.tsx");

describe("the customer's analytics", () => {
  const source = readFileSync(CUSTOMER_ANALYTICS, "utf8");

  it("cannot reach the AI spend at all", () => {
    for (const reader of ["aiSpendByEdition", "aiSpendByService", "aiSpendByModel"]) {
      expect(source, `${reader} is the operator's figure`).not.toContain(reader);
    }
    expect(source).not.toContain("aiCostCents");
  });

  it("has no way to compute an AI bill, so it cannot grow one back", () => {
    // The readers were deleted rather than left unused: an unused query is a paragraph waiting to
    // be re-added to a page, and this one is the operator's, not the customer's.
    expect(readFileSync(CUSTOMER_READ_MODEL, "utf8")).not.toContain("aiJobs");
  });

  it("shows what did happen to the issues that went out", () => {
    // The thing a newsroom came here for, and what the page said nothing about before.
    expect(source).toContain("readerDelivery");
    for (const word of ["Delivered", "Opened", "Clicked", "Bounced"]) expect(source).toContain(word);
  });
});

describe("the platform console", () => {
  it("still has the costs, because somebody does have to see them", () => {
    const source = readFileSync(PLATFORM_COSTS, "utf8");
    expect(source.toLowerCase()).toContain("cost");
  });
});
