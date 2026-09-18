import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { ensureDefaultPlans } from "@/server/billing/plans";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPublication, updatePublication } from "@/server/publications/service";
import { recipientsFor, unsubscribe } from "@/server/subscribers/service";
import { completePaidCheckout, connectReaderPayments, disconnectReaderPayments, readerPaymentsFor, startPaidCheckout, syncPaidReaders } from "@/server/payments/readers";
import { setStripeTransportForTests } from "@/server/payments/stripe-account";

/**
 * A paid title, end to end, against a Stripe that lives in this file.
 *
 * Every call Briefly makes is answered here and recorded, so the test can say not only what
 * Briefly concluded but what it asked for: the price it created, the checkout it opened, the
 * cancellation it sent. The real Stripe is one transport away and takes the same requests.
 */
const KEY = "sk_test_fakekey1234567890";

type Call = { method: string; path: string; body: URLSearchParams };
const calls: Call[] = [];
let subscriptionStatus: "active" | "canceled" = "active";
let priceCounter = 0;

function fakeStripe(url: string, init: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/v1/, "");
  const method = init.method ?? "POST";
  const body = new URLSearchParams(typeof init.body === "string" ? init.body : "");
  calls.push({ method, path, body });
  const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }));
  const auth = (init.headers as Record<string, string>).authorization;
  if (auth !== `Bearer ${KEY}`) return json({ error: { message: "Invalid API Key provided" } }, 401);

  if (method === "GET" && path === "/account") return json({ id: "acct_albert", settings: { dashboard: { display_name: "Albert School" } }, charges_enabled: true });
  if (method === "POST" && path === "/products") return json({ id: "prod_1" });
  if (method === "POST" && path === "/prices") return json({ id: `price_${++priceCounter}` });
  if (method === "POST" && path === "/checkout/sessions") {
    const metadata = Object.fromEntries([...body.entries()].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice(9, -1), value]));
    sessions.set("cs_1", metadata);
    return json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1", status: "open", customer: null, subscription: null, metadata });
  }
  if (method === "GET" && path.startsWith("/checkout/sessions/")) {
    const id = path.split("/").pop()!;
    const metadata = sessions.get(id);
    return metadata ? json({ id, url: null, status: "complete", customer: "cus_1", subscription: "sub_1", metadata }) : json({ error: { message: "No such checkout session" } }, 404);
  }
  if (method === "GET" && path === "/subscriptions/sub_1") {
    return json({ id: "sub_1", status: subscriptionStatus, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, cancel_at_period_end: false });
  }
  if (method === "POST" && path === "/subscriptions/sub_1") {
    return json({ id: "sub_1", status: "active", current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, cancel_at_period_end: body.get("cancel_at_period_end") === "true" });
  }
  return json({ error: { message: `unexpected ${method} ${path}` } }, 400);
}
const sessions = new Map<string, Record<string, string>>();

describe("a paid title", () => {
  let orgId: string;
  let adminId: string;
  let publicationId: string;
  let slug: string;
  const email = "reader@example.com";

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    setStripeTransportForTests(fakeStripe);
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    await db.delete(s.subscribers).where(and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, email)));
    await runAsOrganization(orgId, async () => {
      const publication = await createPublication(orgId, { name: "The Paid Letter", defaultFormats: ["EMAIL"], language: "en", cadence: "monthly", isPublic: true, status: "ACTIVE" }, adminId);
      publicationId = publication.id;
      slug = publication.subscribeSlug!;
    });
  });

  afterAll(async () => {
    setStripeTransportForTests(null);
  });

  const subscription = () => db.query.publicationSubscriptions.findFirst({ where: and(eq(s.publicationSubscriptions.publicationId, publicationId), eq(s.publicationSubscriptions.subscriberId, subscriberIdOf())) });
  let subscriberId = "";
  const subscriberIdOf = () => subscriberId;

  it("cannot charge before the workspace's own Stripe is connected", async () => {
    await expect(runAsOrganization(orgId, () => updatePublication(orgId, publicationId, { access: "paid", priceCents: 500 }, adminId))).rejects.toThrow(/Connect your Stripe account/);
  });

  it("refuses a key Stripe refuses, and keeps nothing", async () => {
    await expect(connectReaderPayments(orgId, "sk_test_wrongkey000000000", adminId)).rejects.toThrow(/did not accept/);
    expect(await readerPaymentsFor(orgId)).toBeNull();
  });

  it("connects, keeps the key sealed, and names the account", async () => {
    const status = await connectReaderPayments(orgId, KEY, adminId);
    expect(status.accountName).toBe("Albert School");
    expect(status.livemode).toBe(false);
    expect(status.keyHint.endsWith("7890")).toBe(true);
    const org = await db.query.organizations.findFirst({ where: eq(s.organizations.id, orgId), columns: { readerPayments: true } });
    expect(org?.readerPayments?.secretKey.v).toBe(1);
    expect(JSON.stringify(org?.readerPayments)).not.toContain(KEY);
  });

  it("makes the title paid by creating one product and one price in the customer's Stripe", async () => {
    calls.length = 0;
    const row = await runAsOrganization(orgId, () => updatePublication(orgId, publicationId, { access: "paid", priceCents: 500, priceCurrency: "eur", priceInterval: "month" }, adminId));
    expect(row.access).toBe("paid");
    expect(calls.filter((call) => call.path === "/products")).toHaveLength(1);
    const price = calls.find((call) => call.path === "/prices")!;
    expect(price.body.get("unit_amount")).toBe("500");
    expect(price.body.get("currency")).toBe("eur");
    expect(price.body.get("recurring[interval]")).toBe("month");

    // Renaming does not touch Stripe; changing the price makes a new price on the same product.
    calls.length = 0;
    await runAsOrganization(orgId, () => updatePublication(orgId, publicationId, { name: "The Paid Letter, renamed" }, adminId));
    expect(calls.filter((call) => call.path === "/products" || call.path === "/prices")).toHaveLength(0);
    await runAsOrganization(orgId, () => updatePublication(orgId, publicationId, { priceCents: 700 }, adminId));
    expect(calls.filter((call) => call.path === "/products")).toHaveLength(0);
    expect(calls.filter((call) => call.path === "/prices")).toHaveLength(1);
  });

  it("sends a reader to Stripe's checkout for the title's price, recorded as pending", async () => {
    calls.length = 0;
    const { url } = await startPaidCheckout(publicationId, { email, locale: "en" });
    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_1");
    const checkout = calls.find((call) => call.path === "/checkout/sessions")!;
    expect(checkout.body.get("mode")).toBe("subscription");
    expect(checkout.body.get("line_items[0][price]")).toBe("price_2");
    expect(checkout.body.get("success_url")).toContain(`/s/${slug}/welcome?session_id={CHECKOUT_SESSION_ID}`);
    expect(checkout.body.get("customer_email")).toBe(email);

    const subscriber = (await db.query.subscribers.findFirst({ where: and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, email)) }))!;
    subscriberId = subscriber.id;
    expect(subscriber.status).toBe("PENDING");
    expect((await subscription())?.checkoutSessionId).toBe("cs_1");
    // Nobody receives anything before they have paid.
    expect((await recipientsFor(publicationId)).map((r) => r.email)).not.toContain(email);
  });

  it("subscribes the reader when Stripe says the checkout completed", async () => {
    const { subscriber } = await completePaidCheckout(slug, "cs_1");
    expect(subscriber.status).toBe("SUBSCRIBED");
    const row = (await subscription())!;
    expect(row.paymentStatus).toBe("active");
    expect(row.paymentSubscriptionId).toBe("sub_1");
    expect(row.paidThrough!.getTime()).toBeGreaterThan(Date.now());
    expect((await recipientsFor(publicationId)).map((r) => r.email)).toContain(email);
    // A session that Stripe does not know is not a payment.
    await expect(completePaidCheckout(slug, "cs_forged")).rejects.toThrow();
  });

  it("does not open a second checkout for an address that already pays", async () => {
    calls.length = 0;
    expect((await startPaidCheckout(publicationId, { email, locale: "en" })).url).toBeNull();
    expect(calls.filter((call) => call.path === "/checkout/sessions")).toHaveLength(0);
  });

  it("stops the charges when the reader leaves, at the end of what they paid for", async () => {
    calls.length = 0;
    const token = (await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, subscriberId) }))!.unsubscribeToken;
    await unsubscribe(token, publicationId);
    const cancel = calls.find((call) => call.method === "POST" && call.path === "/subscriptions/sub_1")!;
    expect(cancel.body.get("cancel_at_period_end")).toBe("true");
    expect((await subscription())?.paymentStatus).toBe("canceled");
    expect((await recipientsFor(publicationId)).map((r) => r.email)).not.toContain(email);
  });

  it("ends a subscription here when Stripe says it ended there", async () => {
    // Back in, then the card fails: Stripe reports the subscription cancelled at the next check.
    await startPaidCheckout(publicationId, { email, locale: "en" });
    await completePaidCheckout(slug, "cs_1");
    expect((await recipientsFor(publicationId)).map((r) => r.email)).toContain(email);
    await db.update(s.publicationSubscriptions).set({ paidThrough: new Date(Date.now() - 3_600_000) }).where(and(eq(s.publicationSubscriptions.publicationId, publicationId), eq(s.publicationSubscriptions.subscriberId, subscriberId)));
    subscriptionStatus = "canceled";
    const outcome = await syncPaidReaders();
    expect(outcome.stopped).toBeGreaterThanOrEqual(1);
    expect((await subscription())?.isActive).toBe(false);
    expect((await recipientsFor(publicationId)).map((r) => r.email)).not.toContain(email);
    subscriptionStatus = "active";
  });

  it("will not disconnect while a title still charges, and will once it is free", async () => {
    await expect(disconnectReaderPayments(orgId, adminId)).rejects.toThrow(/paid title/);
    await runAsOrganization(orgId, () => updatePublication(orgId, publicationId, { access: "free" }, adminId));
    await disconnectReaderPayments(orgId, adminId);
    expect(await readerPaymentsFor(orgId)).toBeNull();
  });
});
