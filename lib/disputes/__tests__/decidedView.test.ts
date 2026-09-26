import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";
import { resolveToken } from "@/lib/i18n/resolveToken";
import { resolveDecidedResponse, type DecidedAuditEvent } from "@/lib/disputes/decidedResponse";
import { buildDecidedView, type DecidedViewInputs } from "@/lib/disputes/decidedView";
import { decidedSummaryParagraph } from "@/lib/disputes/decidedViewText";
import { decidedEmailSections } from "@/lib/email/sendOutcomePostedAlert";
import type { I18nToken } from "@/lib/i18n/token";

const t = createTranslator({ locale: "en", messages: enMessages });
const r = (tok: I18nToken) => resolveToken(t as never, tok) as string;
const fmt = {
  date: (iso: string) => iso.slice(0, 10),
  short: (iso: string) => iso.slice(0, 10),
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

function wonInputs(): DecidedViewInputs {
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
  return inputs360499({
    outcome: "won",
    reason: "FRAUDULENT",
    amount: 142,
    response,
    openedAt: "2026-08-22T10:00:00Z",
    dueAt: "2026-09-05T23:00:00Z",
    closedAt: "2026-09-09T10:00:00Z",
    lineItems: [{ title: "Linen Duvet Set, Queen", quantity: 1 }],
    order: { createdAt: "2026-08-10T10:00:00Z", fulfillmentStatus: "FULFILLED", fulfilledAt: "2026-08-11T10:00:00Z", cancelledAt: null, riskRecommendation: "NONE" },
    fatalLossReason: null,
    events: [],
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
  });
}

describe("decidedView — #360499 (design DecidedView3, 3b)", () => {
  const v = buildDecidedView(inputs360499(), fmt);

  it("hero: title, product · claim, chip, amount label, who responded", () => {
    expect(r(v.outcome.title)).toBe("Dispute lost");
    expect(r(v.outcome.product!)).toBe("The Back to School Bundle (1 item)");
    expect(r(v.outcome.claim)).toBe("Product not received");
    expect(r(v.outcome.chip)).toBe("Final · nothing left to file");
    expect(r(v.outcome.amountLabel)).toBe("Amount lost");
    expect(r(v.who!.first)).toBe("A response was sent through Shopify on 2026-09-12.");
    expect(r(v.who!.second!)).toBe(
      "DisputeDesk held this case: the order was never shipped, so there was no delivery we could truthfully show the bank.",
    );
  });

  it("executive summary reads as one paragraph built from the case's facts", () => {
    expect(decidedSummaryParagraph(v, r, "en")).toBe(
      "The customer told their bank the order never arrived. " +
        "It was never shipped and nothing on record showed a delivery, so there was no honest case to put forward. " +
        "A response was sent through Shopify, and the bank sided with the customer. " +
        "Shipping or refunding orders that are stuck is the surest way to avoid this next time.",
    );
  });

  it("facts: the design's two facts with sources, the first weighted", () => {
    expect(r(v.facts.sub)).toBe("Facts from the order and our records. This is not the bank's reasoning.");
    expect(v.facts.items.map((f) => [r(f.title), r(f.source), f.weighted, f.tone])).toEqual([
      ["The order was never shipped", "Fulfilment status: unfulfilled · From Shopify order data", true, "bad"],
      ["No tracking number or delivery confirmation existed", "From Shopify order data", false, "bad"],
    ]);
    expect(r(v.facts.note!)).toBe(
      "On a not-received claim the bank asks one question: was it delivered? Nothing on record said yes.",
    );
  });

  it("checklist: the design's four rows and pill labels", () => {
    expect(v.checklist.map((c) => [r(c.item), c.state, r(c.label)])).toEqual([
      ["Carrier tracking to the customer's address", "missing", "Missing"],
      ["Delivery confirmation (signature above your threshold)", "missing", "Missing"],
      ["Delivery date promised at checkout", "had", "In policy"],
      ["Customer communication record", "none", "None"],
    ]);
  });

  it("next time: ship-or-cancel with the real 8 unshipped days", () => {
    expect(v.nextTime.map((n) => [r(n.title), r(n.detail!)])).toEqual([
      ["Ship or cancel-and-refund before the customer disputes", "This order sat unshipped for 8 days before the chargeback."],
    ]);
  });

  it("what happened: seven steps, in order, with the design's kinds", () => {
    expect(v.timeline.map((s) => [s.at.slice(0, 10), r(s.title), s.tone])).toEqual([
      ["2026-08-27", "Dispute opened", "muted"],
      ["2026-08-27", "Evidence gathered", "neutral"],
      ["2026-09-01", "Held: order not shipped", "warning"],
      ["2026-09-11", "You were emailed", "neutral"],
      ["2026-09-12", "Response sent through Shopify", "neutral"],
      ["2026-09-16", "You cancelled the order", "neutral"],
      ["2026-09-17", "Lost", "danger"],
    ]);
    expect(r(v.timeline[2].detail!)).toBe("Nothing on record showed delivery, so we did not file.");
    expect(r(v.timeline[6].detail!)).toBe("USD 85.41 was not returned.");
  });
});

describe("decidedView — won, filed by us (design 3a)", () => {
  const v = buildDecidedView(wonInputs(), fmt);

  it("summary names what carried it, when we filed, and that the money stays", () => {
    const text = decidedSummaryParagraph(v, r, "en");
    expect(text.startsWith("The customer told their bank they didn't make this purchase.")).toBe(true);
    expect(text).toContain("they had ordered from you 2 times before without a problem");
    expect(text).toContain("DisputeDesk filed that evidence on 2026-08-30, and the bank ruled in your favour.");
    expect(text.endsWith("The USD 142.00 stays with you.")).toBe(true);
    expect(r(v.outcome.chip)).toBe("Final · the money is yours");
  });

  it("facts are the filed evidence, all good-tone, none weighted; no 'Next time'", () => {
    expect(r(v.facts.title)).toBe("What carried the case");
    expect(r(v.facts.sub)).toBe("Evidence in the response DisputeDesk filed");
    expect(v.facts.items.every((f) => f.tone === "good" && !f.weighted)).toBe(true);
    expect(v.facts.items.map((f) => r(f.title))).toContain("2 earlier orders from this customer were never disputed");
    expect(v.nextTime).toEqual([]);
  });

  it("fraud checklist: the design's four rows", () => {
    expect(v.checklist.map((c) => [r(c.item), r(c.label)])).toEqual([
      ["Billing address and security code match", "On record"],
      ["Delivery to the billing address", "On record"],
      ["Earlier undisputed orders by the same customer", "On record"],
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
            shippingAddress: { city: "Austin", zipPrefix: "787", countryCode: "US", provinceCode: "TX" },
          },
        },
      }),
      fmt,
    );
    expect(v.checklist.find((c) => c.item.key.endsWith("deliveryToBilling"))!.state).toBe("missing");
  });

  it("no evidence items hides the checklist instead of marking every row Missing (prod #347615)", () => {
    expect(buildDecidedView(inputs360499({ outcome: "won", reason: "FRAUDULENT", facts: {} }), fmt).checklist).toEqual([]);
  });

  it("a fraud case with no AVS at all (PayPal, Klarna) drops the row instead of saying Missing", () => {
    const v = buildDecidedView(
      inputs360499({ reason: "FRAUDULENT", facts: { delivery_proof: { proofType: "delivered_confirmed" } } }),
      fmt,
    );
    expect(v.checklist.length).toBeGreaterThan(0);
    expect(v.checklist.map((c) => c.item.key)).not.toContain("disputes.decidedView.checklist.item.addressMatch");
  });

  it("a step dated after the decision is not part of what happened (dev seed #9010)", () => {
    const titles = buildDecidedView(inputs360499({ firstPackAt: "2026-09-24T10:00:00Z" }), fmt).timeline.map((s) => r(s.title));
    expect(titles).not.toContain("Evidence gathered");
    expect(titles[titles.length - 1]).toBe("Lost");
  });

  it("a win with no recorded facts never says 'filed that evidence' (prod #347615)", () => {
    const base = wonInputs();
    const text = decidedSummaryParagraph(buildDecidedView({ ...base, facts: {} }, fmt), r, "en");
    expect(text).toContain("DisputeDesk filed your evidence on 2026-08-30, and the bank ruled in your favour.");
    expect(text).not.toContain("that evidence");
  });

  it("never calls a response sent through Shopify an 'automatic response', in any locale", async () => {
    // Standing rule (maintainer, 2026-09-26): the API cannot tell Shopify's own
    // response from a merchant filing in Admin, so the copy never names it.
    const banned = /automatic response|automatische antwort|respuesta automática|réponse automatique|resposta automática|automatiska svar|on its own|by itself|de lui-même|por su cuenta|por si|på egen hand|antwortet selbst/i;
    for (const loc of ["en", "de", "es", "fr", "pt", "sv"]) {
      const m = (await import(`@/messages/${loc}.json`)).default;
      const text = JSON.stringify([m.disputes.decidedResponse, m.disputes.decidedView]);
      expect(text, loc).not.toMatch(banned);
    }
  });

  it("no response at all omits the who block", () => {
    expect(buildDecidedView(inputs360499({ response: null }), fmt).who).toBeNull();
  });

  it("an inquiry says 'before the inquiry', not 'chargeback'", () => {
    const v = buildDecidedView(inputs360499({ phase: "inquiry" }), fmt);
    expect(r(v.nextTime[0].detail!)).toContain("before the inquiry");
  });

  it("every key the builder can emit exists in English, for every reason and outcome", () => {
    const reasons = ["FRAUDULENT", "PRODUCT_NOT_RECEIVED", "PRODUCT_UNACCEPTABLE", "SUBSCRIPTION_CANCELLED", "DUPLICATE", "CREDIT_NOT_PROCESSED", "GENERAL"];
    for (const reason of reasons) {
      for (const outcome of ["won", "lost"] as const) {
        const v = buildDecidedView(inputs360499({ reason, outcome }), fmt);
        const tokens: I18nToken[] = [
          v.outcome.title, v.outcome.claim, v.outcome.amountLabel, v.outcome.chip,
          v.summary.claim, v.summary.response, ...v.summary.clauses,
          ...(v.summary.closing ? [v.summary.closing] : []),
          v.facts.title, v.facts.sub,
          ...v.facts.items.flatMap((f) => [f.title, f.source]),
          ...v.checklist.flatMap((c) => [c.item, c.label]),
          ...v.nextTime.flatMap((n) => [n.title, ...(n.detail ? [n.detail] : [])]),
          ...v.timeline.flatMap((s) => [s.title, ...(s.detail ? [s.detail] : [])]),
        ];
        for (const tok of tokens) expect(r(tok), `${reason}/${outcome} ${tok.key}`).not.toContain("disputes.");
        expect(decidedSummaryParagraph(v, r, "en")).not.toContain("disputes.");
      }
    }
  });
});

describe("outcome email — same content as the page", () => {
  it("#360499's email carries the page's summary, facts and 'Next time'", async () => {
    const inputs = inputs360499();
    const s = (await decidedEmailSections("en", inputs))!;
    const v = buildDecidedView(inputs, {
      date: (iso) => new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }),
      short: (iso) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" }),
      money: (a, c) => `${c} ${a.toFixed(2)}`,
    });
    expect(s.summary).toBe(decidedSummaryParagraph(v, r, "en"));
    expect(s.whoFirst).toBe("A response was sent through Shopify on Sep 12, 2026.");
    expect(s.facts.map((f) => f.title)).toEqual([
      "The order was never shipped",
      "No tracking number or delivery confirmation existed",
    ]);
    expect(s.next.map((n) => n.title)).toEqual(["Ship or cancel-and-refund before the customer disputes"]);
    expect(s.chip).toBe("Final · nothing left to file");
  });

  it("a win's email says what carried it and has no 'Next time'", async () => {
    const s = (await decidedEmailSections("en", wonInputs()))!;
    expect(s.summary).toContain("the bank ruled in your favour");
    expect(s.next).toEqual([]);
    expect(s.chip).toBe("Final · the money is yours");
  });

  it("renders in every locale without leaking a key", async () => {
    for (const loc of ["en", "de", "es", "fr", "pt", "sv"] as const) {
      const s = (await decidedEmailSections(loc, inputs360499()))!;
      expect(s, loc).not.toBeNull();
      expect(JSON.stringify(s), loc).not.toContain("disputes.");
    }
  });
});
