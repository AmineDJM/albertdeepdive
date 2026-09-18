import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { costsBreakdown, costsCsv, userSheet, workspaceSheet } from "@/server/platform/insights";
import { paymentsOverview, retryInvoicePayment, sendPaymentReminder, syncSubscriptionFromStripe } from "@/server/platform/payments";

/**
 * The console's insights, against the seed.
 *
 * The seed stamps its model calls with Albert School and its editor in chief, over the last three
 * weeks, so every cut of the bill — by customer, by person, by model, by day — has one known
 * answer to agree with. Stripe is stood in for with a fetch that answers like it.
 */
describe("platform insights", () => {
  let albertOrgId: string;
  let eicId: string;

  beforeAll(async () => {
    await ensureSeeded();
    albertOrgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    eicId = (await db.query.users.findFirst({ where: eq(s.users.email, "eic@albertschool.com") }))!.id;
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("breaks the bill down by customer, person, model and day, and the cuts agree", async () => {
    const breakdown = await costsBreakdown(30);
    const albert = breakdown.byWorkspace.find((row) => row.organizationId === albertOrgId)!;
    expect(albert.aiCalls).toBeGreaterThan(0);
    expect(albert.aiCents).toBeGreaterThan(0);
    expect(albert.marginCents).toBe(albert.revenueCents - albert.aiCents - albert.creativeCents);

    const eic = breakdown.byPerson.find((row) => row.userId === eicId)!;
    expect(eic.aiCalls).toBe(albert.aiCalls);
    expect(eic.workspaces).toContain("Albert School");

    const totalCalls = breakdown.totals.aiCalls;
    expect(breakdown.byModel.reduce((total, row) => total + row.calls, 0)).toBe(totalCalls);
    expect(breakdown.byService.reduce((total, row) => total + row.calls, 0)).toBe(totalCalls);
    expect(breakdown.byDay.reduce((total, row) => total + row.calls, 0)).toBe(totalCalls);
    expect(breakdown.byDay).toHaveLength(31);
    expect(breakdown.byDay.at(-1)?.day).toBe(new Date().toISOString().slice(0, 10));
  });

  it("writes the customer table as a file with one line per workspace", async () => {
    const breakdown = await costsBreakdown(7);
    const csv = costsCsv(breakdown);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toMatch(/^workspace,slug,plan,status,currency,revenue,ai_cost/);
    expect(lines).toHaveLength(breakdown.byWorkspace.length + 1);
    expect(lines.some((line) => line.startsWith("Albert School,albert-school,"))).toBe(true);
  });

  it("assembles one customer's sheet from the same ledgers", async () => {
    const sheet = (await workspaceSheet(albertOrgId))!;
    expect(sheet.organization.slug).toBe("albert-school");
    expect(sheet.subscription.organizationId).toBe(albertOrgId);
    expect(sheet.counts.members).toBeGreaterThan(0);
    expect(sheet.counts.editions).toBeGreaterThan(0);
    expect(sheet.spend30.aiCalls).toBeGreaterThan(0);
    expect(sheet.spendAll.aiCalls).toBeGreaterThanOrEqual(sheet.spend30.aiCalls);
    expect(sheet.byMonth).toHaveLength(6);
    expect(sheet.byMonth.reduce((total, month) => total + month.aiCents, 0)).toBeCloseTo(sheet.spend30.aiCents, 2);
    const eic = sheet.members.find((member) => member.userId === eicId)!;
    expect(eic.aiCalls30).toBe(sheet.spend30.aiCalls);
    expect(eic.role).toBeTruthy();
    // Stripe is off: the sheet says so with null rather than an empty list that looks like "no invoices".
    expect(sheet.invoices).toBeNull();
    expect(await workspaceSheet(randomUUID())).toBeNull();
  });

  it("assembles one person's sheet", async () => {
    const sheet = (await userSheet(eicId))!;
    expect(sheet.user.email).toBe("eic@albertschool.com");
    expect(sheet.workspaces.map((workspace) => workspace.slug)).toContain("albert-school");
    expect(sheet.spend.ai30Calls).toBeGreaterThan(0);
    expect(sheet.spend.byWorkspace.find((row) => row.organizationId === albertOrgId)?.aiCalls).toBe(sheet.spend.ai30Calls);
    expect(sheet.activity.byDay).toHaveLength(31);
    expect(sheet.sessions.active).toBeGreaterThanOrEqual(0);
    expect(await userSheet(randomUUID())).toBeNull();
  });

  it("reads payments from the database alone while Stripe is off", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const overview = await paymentsOverview();
    expect(overview.configured).toBe(false);
    expect(overview.invoices).toEqual([]);
    expect(overview.subscriptions.map((sub) => sub.organizationId)).toContain(albertOrgId);
    expect(overview.mrrCents).toBe(overview.subscriptions.reduce((total, sub) => total + sub.mrrCents, 0));
  });

  describe("with Stripe answering", () => {
    const now = Math.floor(Date.now() / 1000);
    const day = 24 * 60 * 60;
    const invoices = [
      { id: "in_open", number: "A-001", status: "open", customer: "cus_albert", subscription: "sub_albert", amount_due: 4900, amount_paid: 0, amount_remaining: 4900, currency: "eur", created: now - 20 * day, due_date: now - 5 * day, hosted_invoice_url: "https://pay.stripe.test/in_open", invoice_pdf: null, attempted: true, attempt_count: 2, next_payment_attempt: now + day, paid: false, collection_method: "charge_automatically", customer_email: "billing@albertschool.example" },
      { id: "in_paid", number: "A-000", status: "paid", customer: "cus_albert", subscription: "sub_albert", amount_due: 4900, amount_paid: 4900, amount_remaining: 0, currency: "eur", created: now - 10 * day, due_date: null, hosted_invoice_url: "https://pay.stripe.test/in_paid", invoice_pdf: null, attempted: true, attempt_count: 1, next_payment_attempt: null, paid: true, collection_method: "charge_automatically" },
    ];
    const seen: { method: string; url: string }[] = [];

    beforeAll(async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_stub";
      await db.update(s.organizationSubscriptions).set({ stripeCustomerId: "cus_albert", stripeSubscriptionId: "sub_albert" }).where(eq(s.organizationSubscriptions.organizationId, albertOrgId));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const method = init?.method ?? "GET";
          seen.push({ method, url });
          const path = new URL(url).pathname;
          const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
          if (path === "/v1/account") return json({ id: "acct_1", settings: { dashboard: { display_name: "Briefly Test" } } });
          if (path === "/v1/invoices") return json({ data: invoices });
          if (path === "/v1/invoices/in_open") return json(invoices[0]);
          if (path === "/v1/invoices/in_open/pay") return json({ ...invoices[0], status: "paid", paid: true, amount_paid: 4900, amount_remaining: 0 });
          if (path === "/v1/subscriptions/sub_albert") return json({ id: "sub_albert", status: "past_due", customer: "cus_albert", cancel_at_period_end: true, current_period_end: now + 12 * day, trial_end: null, items: { data: [{ price: { id: "price_1", recurring: { interval: "year" } } }] } });
          return json({ error: { message: `unexpected ${method} ${path}` } }, 404);
        }),
      );
    });

    it("maps invoices onto workspaces and flags the one somebody has to chase", async () => {
      const overview = await paymentsOverview();
      expect(overview.configured).toBe(true);
      expect(overview.account).toBe("Briefly Test");
      expect(overview.livemode).toBe(false);
      expect(overview.invoices).toHaveLength(2);
      expect(overview.overdue.map((invoice) => invoice.id)).toEqual(["in_open"]);
      expect(overview.overdue[0].workspace?.name).toBe("Albert School");
      expect(overview.collected30Cents).toBe(4900);
      expect(overview.outstandingCents).toBe(4900);
      const sheet = (await workspaceSheet(albertOrgId))!;
      expect(sheet.invoices?.rows.map((invoice) => invoice.number)).toEqual(["A-001", "A-000"]);
    });

    it("reminds the people who run the workspace, in writing, with the link that pays", async () => {
      const result = await sendPaymentReminder("in_open", { appName: "Briefly" });
      expect(result.sentTo).toContain("admin@albertschool.com");
      const [mail] = await db.select().from(s.emailLog).where(and(eq(s.emailLog.template, "billing_reminder"), eq(s.emailLog.to, "admin@albertschool.com")));
      expect(mail.subject).toContain("A-001");
      expect(mail.html).toContain("https://pay.stripe.test/in_open");
      const [entry] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, "billing.reminder"));
      expect(entry.organizationId).toBe(albertOrgId);
    });

    it("charges the card again on request", async () => {
      const invoice = await retryInvoicePayment("in_open");
      expect(invoice.status).toBe("paid");
      expect(seen.some((call) => call.method === "POST" && call.url.endsWith("/v1/invoices/in_open/pay"))).toBe(true);
    });

    it("pulls a subscription's state from Stripe with the webhook's own mapping", async () => {
      const synced = await syncSubscriptionFromStripe(albertOrgId);
      expect(synced.status).toBe("PAST_DUE");
      expect(synced.cancelAtPeriodEnd).toBe(true);
      expect(synced.interval).toBe("year");
      const local = await db.query.organizationSubscriptions.findFirst({ where: eq(s.organizationSubscriptions.organizationId, albertOrgId) });
      expect(local?.status).toBe("PAST_DUE");
    });
  });
});
