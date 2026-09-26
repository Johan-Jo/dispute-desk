import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";
import { resolveToken } from "@/lib/i18n/resolveToken";
import { resolveDecidedResponse, type DecidedAuditEvent } from "@/lib/disputes/decidedResponse";
import { buildDecidedView, type DecidedViewInputs } from "@/lib/disputes/decidedView";
import type { I18nToken } from "@/lib/i18n/token";

const t = createTranslator({ locale: "en", messages: enMessages });
const r = (tok: I18nToken) => resolveToken(t as never, tok) as string;
const fmt = {
  date: (iso: string) => iso.slice(0, 10),
  money: (a: number, c: string) => `${c} ${a.toFixed(2)}`,
};

/** Order #360499, blume-box — prod rows as read 2026-09-26. */
const EVENTS: DecidedAuditEvent[] = [
  {
    event_type: "auto_save_blocked",
    event_payload: { reasons: ["strength_insufficient"], case_strength: "weak" },
    created_at: "2026-08-27T18:24:56Z",
  },
  {
    event_type: "auto_save_blocked",
    event_payload: { reasons: ["fatal-loss condition (inr_no_fulfillment)"], fatal_loss: "inr_no_fulfillment" },
    created_at: "2026-09-01T23:14:43Z",
  },
  { event_type: "fatal_loss_alert_sent", event_payload: { reason: "inr_no_fulfillment" }, created_at: "2026-09-11T06:16:49Z" },
];

function inputs360499(over: Partial<DecidedViewInputs> = {}): DecidedViewInputs {
  const response = resolveDecidedResponse({
    closedAt: "2026-09-17T11:20:31Z",
    dueAt: "2026-09-11T23:00:00Z",
    evidenceSentOn: "2026-09-12T07:43:03Z",
    installedAt: "2026-03-10T00:00:00Z",
    weFiledAt: null,
    hasPack: true,
    reviewState: null,
    events: EVENTS,
  });
  return {
    outcome: "lost",
    phase: "chargeback",
    reason: "PRODUCT_NOT_RECEIVED",
    amount: 85.41,
    currency: "USD",
    openedAt: "2026-08-27T18:22:42Z",
    dueAt: "2026-09-11T23:00:00Z",
    closedAt: "2026-09-17T11:20:31Z",
    response,
    order: {
      createdAt: "2026-08-19T17:12:02Z",
      fulfillmentStatus: "UNFULFILLED",
      fulfilledAt: null,
      cancelledAt: "2026-09-16T16:31:36Z",
      riskRecommendation: "NONE",
    },
    lineItems: [{ title: "The Back to School Bundle", quantity: 1 }],
    facts: {
      order_confirmation: { fulfillmentStatus: "IN_PROGRESS" },
      no_return_initiated: { returnStatus: "NO_RETURN" },
      customer_account_info: { priorUndisputedOrders: 0, disputeFreeHistory: true },
      shipping_policy: { policyType: "shipping" },
      avs_cvv_match: { avsResultCode: "U", cardCompany: "Visa" },
      ip_location_check: { locationMatch: "same_country", riskLevel: "low" },
    },
    fatalLossReason: "inr_no_fulfillment",
    firstPackAt: "2026-08-27T18:23:37Z",
    events: EVENTS,
    ...over,
  };
}

describe("decidedView — order #360499 (design 1a)", () => {
  const v = buildDecidedView(inputs360499(), fmt);

  it("outcome card: title, product · claim, amount label, who responded", () => {
    expect(r(v.outcome.title)).toBe("Dispute lost");
    expect(r(v.outcome.product!)).toBe("The Back to School Bundle (1 item)");
    expect(r(v.outcome.claim)).toBe("Product not received");
    expect(r(v.outcome.amountLabel)).toBe("Amount lost");
    expect(r(v.who!.first)).toBe("Shopify sent its automatic response on 2026-09-12.");
    expect(r(v.who!.second!)).toBe(
      "DisputeDesk held this case: the order was never shipped, so there was no delivery we could truthfully put in front of the bank.",
    );
  });

  it("what we saw: exactly the design's two facts, and the not-received note", () => {
    expect(r(v.facts.title)).toBe("What we saw in the record");
    expect(v.facts.items.map(r)).toEqual([
      "The order was never shipped (fulfilment status: unfulfilled).",
      "No tracking number or delivery confirmation existed.",
    ]);
    expect(r(v.facts.note!)).toContain('the bank\'s question is "was it delivered?"');
  });

  it("checklist: the design's four rows and states", () => {
    expect(v.checklist.map((c) => [r(c.item), c.state, r(c.label)])).toEqual([
      ["Carrier tracking to the customer's address", "missing", "Missing"],
      ["Delivery confirmation (signature above your threshold)", "missing", "Missing"],
      ["Delivery date promised at checkout", "had", "Policy"],
      ["Customer communication record", "none", "None"],
    ]);
  });

  it("next time: ship-or-cancel with the real 8 unshipped days", () => {
    expect(v.nextTime).toHaveLength(1);
    expect(r(v.nextTime[0].title)).toBe("Ship or cancel-and-refund before the customer disputes.");
    expect(r(v.nextTime[0].detail!)).toBe("This order sat unshipped 8 days before the chargeback.");
  });

  it("what happened: the design's seven steps, in order, with its dot tones", () => {
    expect(v.timeline.map((s) => [s.at.slice(0, 10), r(s.title), s.tone])).toEqual([
      ["2026-08-27", "Dispute opened", "muted"],
      ["2026-08-27", "Evidence gathered", "neutral"],
      ["2026-09-01", "Held: order not shipped", "warning"],
      ["2026-09-11", "You were emailed", "neutral"],
      ["2026-09-12", "Shopify's automatic response sent", "neutral"],
      ["2026-09-16", "You cancelled the order", "neutral"],
      ["2026-09-17", "Lost", "danger"],
    ]);
    expect(r(v.timeline[0].detail!)).toBe("Product not received. Response due 2026-09-11.");
    expect(r(v.timeline[6].detail!)).toBe("USD 85.41 was not returned.");
  });
});

describe("decidedView — won, filed by us (design 1b)", () => {
  const response = resolveDecidedResponse({
    closedAt: "2026-09-09T10:00:00Z",
    dueAt: "2026-09-05T23:00:00Z",
    evidenceSentOn: "2026-08-31T10:00:00Z",
    installedAt: "2026-03-10T00:00:00Z",
    weFiledAt: "2026-08-30T10:00:00Z",
    hasPack: true,
    reviewState: null,
    events: [],
  });
  const v = buildDecidedView(
    inputs360499({
      outcome: "won",
      reason: "FRAUDULENT",
      amount: 142,
      response,
      openedAt: "2026-08-22T10:00:00Z",
      dueAt: "2026-09-05T23:00:00Z",
      closedAt: "2026-09-09T10:00:00Z",
      order: { createdAt: "2026-08-10T10:00:00Z", fulfillmentStatus: "FULFILLED", fulfilledAt: "2026-08-11T10:00:00Z", cancelledAt: null, riskRecommendation: "NONE" },
      fatalLossReason: null,
      facts: {
        avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M", cardCompany: "Visa" },
        delivery_proof: { proofType: "delivered_confirmed", signedByName: null },
        shipping_tracking: { carrier: "UPS" },
        customer_account_info: { priorUndisputedOrders: 2 },
        order_confirmation: {
          billingAddress: { city: "Leeds", zipPrefix: "LS1", countryCode: "GB", provinceCode: "ENG" },
          shippingAddress: { city: "leeds", zipPrefix: "LS1", countryCode: "GB", provinceCode: "ENG" },
        },
      },
      events: [],
    }),
    fmt,
  );

  it("says we filed, has no 'Next time', and names what carried it", () => {
    expect(r(v.outcome.title)).toBe("Dispute won");
    expect(r(v.outcome.amountLabel)).toBe("Recovered");
    expect(r(v.who!.first)).toBe("DisputeDesk filed your evidence on 2026-08-30.");
    expect(v.who!.second).toBeNull();
    expect(v.nextTime).toEqual([]);
    expect(r(v.facts.title)).toBe("What carried the case");
    expect(v.facts.items.map(r)).toContain(
      "The customer had 2 earlier orders from this store that were never disputed.",
    );
    expect(v.facts.note).toBeNull();
  });

  it("timeline marks our filing in primary and the win in success", () => {
    const tones = Object.fromEntries(v.timeline.map((s) => [r(s.title), s.tone]));
    expect(tones["DisputeDesk filed your evidence"]).toBe("primary");
    expect(tones["Won"]).toBe("success");
    // Shopify forwarding our filing is not "Shopify's automatic response".
    expect(Object.keys(tones)).not.toContain("Shopify's automatic response sent");
  });

  it("fraud checklist shows the design's four rows", () => {
    expect(v.checklist.map((c) => [r(c.item), r(c.label)])).toEqual([
      ["Billing address and security code match", "Had"],
      ["Delivery to the billing address", "Had"],
      ["Earlier undisputed orders by the same customer", "Had"],
      ["3-D Secure authentication", "Not used"],
    ]);
  });
});

describe("decidedView — guards", () => {
  it("delivery alone is not 'Delivery to the billing address' (prod #349145)", () => {
    const v = buildDecidedView(
      inputs360499({
        reason: "FRAUDULENT",
        facts: {
          avs_cvv_match: { avsResultCode: "N", cardCompany: "Visa" },
          delivery_proof: { proofType: "delivered_confirmed", signedByName: null },
          order_confirmation: {
            billingAddress: { city: "Austin", zipPrefix: "787", countryCode: "US", provinceCode: "TX" },
            shippingAddress: { city: "Dallas", zipPrefix: "752", countryCode: "US", provinceCode: "TX" },
          },
        },
      }),
      fmt,
    );
    const row = v.checklist.find((c) => c.item.key.endsWith("deliveryToBilling"))!;
    expect(row.state).toBe("missing");
  });

  it("no evidence items at all hides the checklist rather than marking every row Missing (prod #347615)", () => {
    const v = buildDecidedView(inputs360499({ outcome: "won", reason: "FRAUDULENT", facts: {} }), fmt);
    expect(v.checklist).toEqual([]);
  });

  it("a fraud case with no AVS at all (PayPal, Klarna) drops the row instead of saying Missing", () => {
    const v = buildDecidedView(
      inputs360499({ reason: "FRAUDULENT", facts: { delivery_proof: { proofType: "delivered_confirmed" } } }),
      fmt,
    );
    expect(v.checklist.length).toBeGreaterThan(0);
    expect(v.checklist.map((c) => c.item.key)).not.toContain("disputes.decidedView.checklist.item.addressMatch");
  });

  it("no response at all (design 1g 'unknown') omits the who block", () => {
    const v = buildDecidedView(inputs360499({ response: null }), fmt);
    expect(v.who).toBeNull();
  });

  it("an inquiry says 'before the inquiry', not 'chargeback'", () => {
    const v = buildDecidedView(inputs360499({ phase: "inquiry" }), fmt);
    expect(r(v.nextTime[0].detail!)).toContain("before the inquiry");
  });

  it("every key the builder can emit exists in English", () => {
    const reasons = ["FRAUDULENT", "PRODUCT_NOT_RECEIVED", "PRODUCT_UNACCEPTABLE", "SUBSCRIPTION_CANCELLED", "DUPLICATE", "CREDIT_NOT_PROCESSED", "GENERAL"];
    for (const reason of reasons) {
      for (const outcome of ["won", "lost"] as const) {
        const v = buildDecidedView(inputs360499({ reason, outcome }), fmt);
        const tokens: I18nToken[] = [
          v.outcome.title,
          v.outcome.claim,
          v.outcome.amountLabel,
          ...v.facts.items,
          ...v.checklist.flatMap((c) => [c.item, c.label]),
          ...v.nextTime.flatMap((n) => [n.title, ...(n.detail ? [n.detail] : [])]),
          ...v.timeline.flatMap((s) => [s.title, ...(s.detail ? [s.detail] : [])]),
        ];
        for (const tok of tokens) expect(() => r(tok), `${reason}/${outcome} ${tok.key}`).not.toThrow();
        for (const tok of tokens) expect(r(tok), tok.key).not.toContain("disputes.decidedView");
      }
    }
  });
});
