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
const CUSTOMER_SERVICE = join(process.cwd(), "src", "server", "analytics", "service.ts");
const CUSTOMER_SCOPE = join(process.cwd(), "src", "server", "analytics", "scope.ts");
const PLATFORM_ANALYTICS = join(process.cwd(), "src", "server", "platform", "analytics.ts");
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
    for (const path of [CUSTOMER_READ_MODEL, CUSTOMER_SERVICE]) {
      expect(readFileSync(path, "utf8"), path).not.toContain("aiJobs");
    }
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

/**
 * Whose rows are whose.
 *
 * The isolation itself is proved against a database in `tests/integration/analytics-isolation`,
 * with two workspaces and figures that cannot be confused. This is the cheaper, blunter guard that
 * runs on every commit: the shape that made the bug possible must not come back.
 */
describe("the customer's read model", () => {
  const files = [readFileSync(CUSTOMER_READ_MODEL, "utf8"), readFileSync(CUSTOMER_SERVICE, "utf8")];

  it("takes a scope that cannot be built without a workspace", () => {
    for (const source of files) {
      expect(source).toContain("TenantScope");
      // The old shape, where a workspace was one optional field among four.
      expect(source).not.toContain("AnalyticsScope");
    }
    const scope = readFileSync(CUSTOMER_SCOPE, "utf8");
    expect(scope).toContain("readonly organizationId: string;");
    expect(scope).not.toContain("organizationId?:");
  });

  it("never asks whether it has a workspace before filtering on one", () => {
    // `if (workspaceId) applyFilter()` is how this bug returns. There is no branch: every query
    // starts with `ownedBy` or `inOwnEditions`, which take the workspace from a value that has one.
    for (const source of files) {
      expect(source).not.toMatch(/if \(scope\.organizationId\)/);
      expect(source).not.toMatch(/organizationId \? /);
    }
  });

  it("gets its workspace from the session, never from the request", () => {
    const scope = readFileSync(CUSTOMER_SCOPE, "utf8");
    expect(scope).toContain("currentOrganizationId()");
    // And the one id that does come from the URL is checked before it is used.
    expect(scope).toContain("verifyEdition");
  });
});

describe("the platform's read model", () => {
  it("is a different module, so crossing workspaces is a decision and not an omission", () => {
    const platform = readFileSync(PLATFORM_ANALYTICS, "utf8");
    expect(platform).toContain("platformTotals");
    expect(platform).toContain("workspaceAnalyticsForAdmin");
    // It reaches the customer's readers only through the admin door, which names one workspace.
    expect(platform).toContain("workspaceScopeForAdmin");
  });
});
