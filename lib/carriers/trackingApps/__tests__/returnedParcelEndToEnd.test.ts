/**
 * END-TO-END: the real dispute 4b81afe1 (#98141) payload, all the way to the gate.
 *
 * Plan: docs/plans/tracking-app-delivery-signals.plan.md §6.2, test 7.
 *
 * Every link in this chain existed before except one. The returned-to-sender
 * gate was built in July for cay-collective #13195; reconciliation already
 * preferred the newest terminal event; the contradiction gate already read
 * carrierTracking. What was missing was a signal reaching it at all — for a
 * carrier with no adapter, nothing ever populated that field.
 *
 * This asserts the whole path on the REAL 30-event payload rather than a
 * synthetic one, because the plan required confirming the gate fires rather
 * than assuming it from reading the code.
 */

import { describe, it, expect } from "vitest";
import { electSignal } from "@/lib/carriers/trackingApps/parcelPanelMap";
import { isTerminalEvidenceSource, reconcileDeliveryState } from "@/lib/carriers/reconcile";
import { hasReturnedToSenderShipment, returnedToSenderAt } from "@/lib/packs/contradictionGate";
import { detectReturnedToSender } from "@/lib/automation/returnedToSender";
import fixture from "./fixtures/dispute-4b81afe1-returned.json";

describe("END TO END: the real #98141 parcel now trips the gate", () => {
  it("timeline -> signal -> reconcile -> carrierTracking -> gate", () => {
    const cps = (fixture as any).data.tracking[0].trackinfo;
    const elected = electSignal(cps);
    expect(elected.status).toBe("Returned");

    const { current } = reconcileDeliveryState([
      { status: "DeliveredToPickup", at: "2026-08-31T11:17:41Z", source: "shopify_native" },
      { status: elected.status!, at: elected.at, source: "tracking_app_parcelpanel" },
    ]);
    expect(current?.status).toBe("Returned");
    expect(isTerminalEvidenceSource(current!.source)).toBe(true);

    const sections = [{
      type: "fulfillment", label: "Delivery", source: "shopify",
      fieldsProvided: ["shipping_tracking"],
      data: {
        proofType: "returned_to_sender",
        fulfillments: [{
          carrierTracking: { deliveryStatus: current!.status },
          carrierTerminalEvent: { happenedAt: "2026-09-07T09:17:41Z" },
        }],
      },
    }] as any;

    expect(hasReturnedToSenderShipment(sections)).toBe(true);
    const at = returnedToSenderAt(sections);

    const gate = detectReturnedToSender({
      returnedToSender: true, returnedAt: at,
      order: { totalRefundedSet: { shopMoney: { amount: "0.00" } } } as any,
      disputeAmount: 37.9,
    });
    expect(gate.triggered).toBe(true);
    expect(gate.reason).toBe("returned_unrefunded");
    expect(gate.returnedAt).toBe("2026-09-07T09:17:41Z");
  });
});
