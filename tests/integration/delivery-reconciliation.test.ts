import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { applyDrift, deliveryDrift } from "@/server/email/reconcile";
import { deliveryFrom } from "@/server/email/events";
import { parseResendEvent } from "@/server/email/providers/resend";
import { runQc } from "@/server/qc";

/**
 * A webhook that never arrived, and the log that is quietly wrong because of it.
 *
 * The failure being reproduced is the ordinary one: the provider reported a hard bounce, the
 * endpoint was down for the ten seconds it took to deliver it, and from then on every screen in
 * the product says the newsletter reached somebody it did not reach. Nothing throws. Nothing turns
 * red. The only way to find it is to hold the log up against what the provider actually said.
 *
 * So the events are stored as the provider sent them and the log is left saying something else —
 * which is exactly the state a dropped webhook leaves behind — and the check is asked whether it
 * notices. Then the repair is asked to put it right, and the same measurement is taken again.
 */

const MESSAGE_ID = "qc-recon-message-0001";
const BOUNCED_TO = "bounced@example.test";
const DELIVERED_TO = "delivered@example.test";

const bounceBody = (at: string) => ({
  type: "email.bounced",
  created_at: at,
  data: { email_id: MESSAGE_ID, to: [BOUNCED_TO], bounce: { type: "Permanent", subType: "General", message: "The address does not exist" } },
});

describe("reconciling the delivery log with the provider", () => {
  let organizationId: string;
  const made: string[] = [];

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, seeded.editionId) });
    organizationId = edition!.organizationId!;

    const sentAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    // One message the provider said bounced, whose log row still says it was delivered.
    const [bounced] = await db
      .insert(s.emailLog)
      .values({
        organizationId,
        to: BOUNCED_TO,
        subject: "Edition #1",
        html: "<p>Hello</p>",
        status: "SENT",
        provider: "resend",
        providerMessageId: MESSAGE_ID,
        delivery: "DELIVERED",
        deliveredAt: sentAt,
        sentAt,
        createdAt: sentAt,
      })
      .returning({ id: s.emailLog.id });
    made.push(bounced.id);

    await db.insert(s.emailEvents).values({
      providerEventId: `${MESSAGE_ID}-bounce`,
      provider: "resend",
      type: "email.bounced",
      organizationId,
      emailLogId: bounced.id,
      recipient: BOUNCED_TO,
      payload: bounceBody(sentAt.toISOString()),
      occurredAt: sentAt,
    });

    // And one the provider has never said anything about, sent long enough ago that silence means
    // something.
    const [silent] = await db
      .insert(s.emailLog)
      .values({
        organizationId,
        to: DELIVERED_TO,
        subject: "Edition #1",
        html: "<p>Hello</p>",
        status: "SENT",
        provider: "resend",
        providerMessageId: `${MESSAGE_ID}-silent`,
        delivery: "PENDING",
        sentAt,
        createdAt: sentAt,
      })
      .returning({ id: s.emailLog.id });
    made.push(silent.id);
  }, 180_000);

  afterAll(async () => {
    if (made.length) {
      await db.delete(s.emailEvents).where(inArray(s.emailEvents.emailLogId, made));
      await db.delete(s.emailLog).where(inArray(s.emailLog.id, made));
    }
  });

  it("replays the provider's own events through the handler's own rules", () => {
    // Not a second opinion about what a bounce means: the same function the live webhook uses.
    const event = parseResendEvent(bounceBody(new Date().toISOString()), "e1")!;
    expect(event.kind).toBe("bounced");
    expect(event.permanent, "a Permanent bounce is permanent").toBe(true);
    expect(deliveryFrom(event, "PENDING")).toBe("BOUNCED");
    // And a late delivered must never talk over a bounce that already landed.
    const delivered = parseResendEvent({ type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: MESSAGE_ID, to: [BOUNCED_TO] } }, "e2")!;
    expect(deliveryFrom(delivered, "BOUNCED")).toBeNull();
    expect(deliveryFrom(delivered, "PENDING")).toBe("DELIVERED");
  });

  it("finds the message the log is wrong about, and the one nothing was ever said about", async () => {
    const report = await deliveryDrift(organizationId);
    expect(report.checked).toBeGreaterThanOrEqual(2);

    const drift = report.drifted.find((each) => each.to === BOUNCED_TO);
    expect(drift, "the log says delivered where the provider said bounced").toBeDefined();
    expect(drift!.logged).toBe("DELIVERED");
    expect(drift!.reported).toBe("BOUNCED");

    expect(report.unconfirmed, "and one message the provider never reported on at all").toBeGreaterThanOrEqual(1);
    expect(report.unconfirmedSample).toContain(DELIVERED_TO);
  }, 60_000);

  it("puts the provider's version back, and measures again rather than asserting it worked", async () => {
    const before = await deliveryDrift(organizationId);
    const applied = await applyDrift(before.drifted);
    expect(applied).toBe(before.drifted.length);

    const after = await deliveryDrift(organizationId);
    expect(after.drifted, "the same measurement, taken again, finds nothing").toEqual([]);

    const row = await db.query.emailLog.findFirst({ where: eq(s.emailLog.providerMessageId, MESSAGE_ID) });
    expect(row!.delivery).toBe("BOUNCED");
    expect(row!.bouncedAt, "and the moment it bounced is recorded, not invented").not.toBeNull();

    // The silent message is still silent: a repair may not invent an event nobody sent.
    expect(after.unconfirmed).toBe(before.unconfirmed);
  }, 60_000);

  it("reports the drift as a finding, and clears it through the repair loop", async () => {
    // Put the log back out of step, then let the engine do the whole loop itself.
    await db.update(s.emailLog).set({ delivery: "DELIVERED" }).where(eq(s.emailLog.providerMessageId, MESSAGE_ID));
    const seeded = await ensureSeeded();

    const measured = await runQc(seeded.editionId, { only: ["reconciliation"], repair: false, persist: false });
    const finding = measured.findings.find((each) => each.metricId === "delivery.reconciles");
    expect(finding, "a log that disagrees with the provider is a finding").toBeDefined();
    expect(finding!.severity).toBe("FAIL");
    expect(finding!.repairStrategy).toBe("apply-provider-state");

    const repaired = await runQc(seeded.editionId, { only: ["reconciliation"], repair: true, persist: false });
    const again = repaired.findings.find((each) => each.metricId === "delivery.reconciles" && !each.repaired);
    expect(again, "and after the repair the remeasure finds nothing to report").toBeUndefined();
    expect(repaired.repairs.some((each) => each.strategy === "apply-provider-state" && each.succeeded)).toBe(true);
  }, 180_000);
});
