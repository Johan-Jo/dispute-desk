/**
 * Not-as-described letters (docs/plans/not-as-described-defence-package.plan.md
 * PR 1, maintainer decision D5 of 2026-09-28): defend without hedging, and
 * never claim more than the records carry.
 */

import { describe, it, expect } from "vitest";
import { runPhraseAndGuardChecks } from "../validateNarrative";
import { product_not_as_described } from "../reasonCodes/families/product_not_as_described";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import { ALL_REASON_CODE_FAMILIES } from "../reasonCodes/familyRegistry";
import { renderThesis } from "../pdf/renderThesis";
import { product_not_as_described_listing_as_purchased } from "../strategies/product_not_as_described_listing_as_purchased";
import { product_not_as_described_narrow_fallback } from "../strategies/product_not_as_described_narrow_fallback";
import { product_unacceptable } from "../reasonCodes/product_unacceptable";
import { NO_INTERNAL_CONSTRAINTS } from "../internalConstraints";
import { buildLlmFactPayload } from "../narrativeWriter";
import { resolveReasonCodeModule } from "../reasonCodes/registry";

function refusals(text: string, family = product_not_as_described, packageMode: "full" | "narrow" = "narrow") {
  return runPhraseAndGuardChecks({
    text,
    sectionKey: "executiveSummary",
    approvedFacts: [],
    packageMode,
    layer: "narrative",
    extraHardPhrases: family.prohibitedBankPhrases,
    guardedPhrases: family.guardedBankPhrases,
    internalConstraints: NO_INTERNAL_CONSTRAINTS,
  }).filter((e) => e.rule === "forbidden_phrase");
}

describe("not-as-described: the rule-10 hedge is refused (D5)", () => {
  it.each([
    "The available evidence supports the merchant's position.",
    "The available records indicate that the order was fulfilled.",
    "The submitted evidence is consistent with a completed sale.",
    "The available evidence is consistent with the order record.",
    "the submitted records suggest the order was processed normally",
  ])("refuses: %s", (text) => {
    expect(refusals(text).length).toBeGreaterThan(0);
  });

  it("refuses the hedge in full mode too — one deterministic list", () => {
    expect(refusals("The available evidence supports the merchant.", product_not_as_described, "full").length).toBeGreaterThan(0);
  });

  it("keeps a bare 'consistent with' legal", () => {
    expect(refusals("The order total is consistent with the listed price of the selected variant.")).toEqual([]);
  });
});

describe("not-as-described: conclusions the records cannot carry are refused", () => {
  it.each([
    "The item was as described.",
    "The goods were exactly as advertised.",
    "The product matched the listing.",
    "The delivered item matches its description.",
    "The merchandise conformed to the product specification in the listing.",
    "The item was not defective.",
    "The goods were free of defects.",
    "The order arrived in perfect condition.",
    "The listing shown is the listing at the time of purchase.",
    "The order was delivered within the expected timeframe.",
    // From the PR 1 comparison letters (#100411, 2026-09-28).
    "No product listing or customer communication evidence has been submitted to support the buyer's assertion that the goods differed from what was advertised.",
    "The buyer has not, on the available record, engaged a return or resolution process with the merchant.",
    "This delivery record is corroborated by two fulfillment entries in the merchant's system.",
    "The customer did not contact the merchant before opening the dispute.",
    "The claim is an unsupported assertion.",
    "In the absence of any return, the claim should fail.",
    // Arrival is not in dispute (maintainer, 2026-09-28).
    "The carrier confirmed delivery on 15 September 2026.",
    "YunExpress recorded delivery confirmation for this shipment (tracking number [tracking]).",
    "The order was delivered on 5 September 2026.",
    "The parcel was shipped on 2 September via DHL.",
    "The shipment is in transit.",
    "The order record confirms it was fulfilled.",
    "The order record further shows the goods left the merchant.",
    "The buyer selected and paid for the item as listed.",
  ])("refuses: %s", (text) => {
    expect(refusals(text).length).toBeGreaterThan(0);
  });
});

describe("not-as-described: confident, true sentences pass", () => {
  it.each([
    "The cardholder states the item was not as described.",
    "The customer ordered the Linen Shirt in size M, blue, for 49.00 EUR.",
    "No return has been recorded in Shopify for this order.",
    "The merchant's listing describes the shirt as 100% linen, retrieved on 28 September 2026.",
    "The cardholder states the goods were not as advertised.",
    "The merchant relies on the absence of any return recorded in Shopify.",
    "The merchant respectfully requests reversal of the chargeback.",
    "The merchant requests that this dispute be resolved in its favour given the absence of any recorded return.",
  ])("passes: %s", (text) => {
    expect(refusals(text)).toEqual([]);
  });
});

describe("not-as-described: payment authentication stays citable (blume-box #352552)", () => {
  it("a liability-shifted 3-D Secure sentence passes", () => {
    expect(refusals("The cardholder was authenticated by the issuer with 3-D Secure.")).toEqual([]);
  });
});

describe("not-as-described: scope — other families are untouched", () => {
  it("the new bans do not apply to item-not-received letters", () => {
    expect(refusals("The available evidence supports the merchant's position.", item_not_received)).toEqual([]);
  });

  it("no other family carries a not-as-described pattern", () => {
    const ours = new Set(product_not_as_described.prohibitedBankPhrases.map((r) => r.source));
    for (const family of ALL_REASON_CODE_FAMILIES) {
      if (family.key === product_not_as_described.key) continue;
      for (const r of family.prohibitedBankPhrases) expect(ours.has(r.source)).toBe(false);
    }
  });
});

describe("not-as-described: prompts carry no banned wording", () => {
  it.each([
    ["family overlay", product_not_as_described.overlayPromptBody],
    ["listing_as_purchased strategy", product_not_as_described_listing_as_purchased.promptBody],
    ["narrow_fallback strategy", product_not_as_described_narrow_fallback.promptBody],
    ["reason module", product_unacceptable.promptBody],
  ])("%s", (_name, body) => {
    for (const r of product_not_as_described.prohibitedBankPhrases) {
      expect(body.match(r)?.[0], String(r)).toBeUndefined();
    }
  });

  it("the overlay names itself an override of rule 10 and keeps the no-conclusion rule", () => {
    expect(product_not_as_described.overlayPromptBody).toContain("OVERRIDE OF RULE 10");
    expect(product_not_as_described.overlayPromptBody).toContain("no declarative reason-code conclusions");
  });
});

describe("not-as-described: PDF thesis lines", () => {
  const base = { approvedFacts: [], caseContext: { disputedAmount: "€80.44" } } as const;

  it("narrow conclusion requests reversal without the 'available evidence' hedge", () => {
    const text = renderThesis({ ...base, sectionKey: "conclusion", familyKey: "product_not_as_described", packageMode: "narrow" } as never);
    expect(text).toBe("The merchant respectfully requests reversal of the €80.44 chargeback.");
  });

  it("other families keep their narrow conclusion", () => {
    const text = renderThesis({ ...base, sectionKey: "conclusion", familyKey: "credit_not_processed", packageMode: "narrow" } as never);
    expect(text).toBe("Based on the available evidence, the merchant respectfully requests review of this chargeback.");
  });

  it("the transaction overview no longer argues cardholder-initiated activity", () => {
    const text = renderThesis({
      ...base,
      sectionKey: "transactionOverviewArgument",
      familyKey: "product_not_as_described",
      packageMode: "narrow",
    } as never);
    expect(text).not.toMatch(/cardholder-initiated/);
  });
});

describe("not-as-described: the writer is not shown the fulfilment status", () => {
  const orderFact = {
    id: "order_confirmation#0",
    category: "order_record",
    label: "Order record",
    value: { fieldKey: "order_confirmation", fulfillmentStatus: "FULFILLED", channel: "web", confirmationSent: true },
    source: "shopify_order",
    sourceRef: null,
    strength: "supporting",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  };
  const payloadFor = (code: string) =>
    buildLlmFactPayload({
      packageId: "p", disputeId: "d", reasonCode: code, packageMode: "narrow", caseStrength: "moderate",
      reasonCodeModule: resolveReasonCodeModule(code), approvedFacts: [orderFact],
      manualEvidence: [], internalOnlyFactIds: [], missingEvidence: [], strategies: [],
    } as never) as { approvedFacts: Array<{ value: Record<string, unknown> }> };

  it("drops fulfillmentStatus for not-as-described", () => {
    expect(payloadFor("13.3").approvedFacts[0].value).not.toHaveProperty("fulfillmentStatus");
    expect(payloadFor("13.3").approvedFacts[0].value).toHaveProperty("channel", "web");
  });

  it("keeps it for item-not-received", () => {
    expect(payloadFor("13.1").approvedFacts[0].value).toHaveProperty("fulfillmentStatus", "FULFILLED");
  });
});
