/**
 * Non-receipt plan P2 (§7, D7; §10 tests 13–14): the analyzer's category is
 * family-aware, enforced deterministically after the model answers.
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CATEGORIES,
  allowedCategoriesFor,
  applyFamilyCategoryPolicy,
  buildAnalyzerPayload,
  ANALYZER_SYSTEM_PROMPT,
  type AnalyzedProposal,
} from "../relevanceAnalyzer";

const proposal = (over: Partial<AnalyzedProposal> = {}): AnalyzedProposal => ({
  id: "m1",
  category: "contradiction",
  explanation: "The customer states they have been waiting, which contradicts a pure non-receipt claim.",
  confidence: 72,
  ...over,
});

const msgs = (text: string, senderType: "customer" | "merchant" = "customer") =>
  new Map([["m1", { senderType, text }]]);

describe("allowedCategoriesFor", () => {
  it("removes contradiction on item-not-received only", () => {
    expect(allowedCategoriesFor("PRODUCT_NOT_RECEIVED")).not.toContain("contradiction");
    expect(allowedCategoriesFor("PRODUCT_NOT_RECEIVED")).toContain("delivery_recognition");
    expect(allowedCategoriesFor("FRAUDULENT")).toEqual(EVIDENCE_CATEGORIES);
    expect(allowedCategoriesFor(null)).toEqual(EVIDENCE_CATEGORIES);
  });

  it("travels in the payload the model sees", () => {
    const { payload } = buildAnalyzerPayload({
      disputeReason: "PRODUCT_NOT_RECEIVED",
      networkReasonCode: "13.1",
      orderName: "#1",
      orderCreatedAt: null,
      deliveredAt: null,
      explanationLocale: "en",
      tickets: [],
    });
    expect(payload.allowedCategories).not.toContain("contradiction");
  });

  it("the prompt names the restated-complaint non-example", () => {
    expect(ANALYZER_SYSTEM_PROMPT).toMatch(/NOT a\s+contradiction: the customer restating/);
    expect(ANALYZER_SYSTEM_PROMPT).toMatch(/allowedCategories/);
  });
});

describe("applyFamilyCategoryPolicy — item not received", () => {
  it("test 13: Case A's shape — waiting + reimbursement request → refund_history, not contradiction", () => {
    const r = applyFamilyCategoryPolicy(
      [proposal()],
      "PRODUCT_NOT_RECEIVED",
      msgs("It has been over 2 weeks and the order has not shipped. Please reimburse me."),
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].category).toBe("refund_history");
    // The model's sentence argued "contradiction" — never shown beside the corrected category.
    expect(r.proposals[0].explanation).toBeNull();
    expect(r.reroutedCount).toBe(1);
  });

  it("a restated complaint with no money-back request is dropped and counted", () => {
    const r = applyFamilyCategoryPolicy(
      [proposal()],
      "PRODUCT_NOT_RECEIVED",
      msgs("I have been waiting over two weeks and still nothing."),
    );
    expect(r.proposals).toHaveLength(0);
    expect(r.rejectedCount).toBe(1);
  });

  it("recognises money-back requests in other locales (shared P0 pattern)", () => {
    const r = applyFamilyCategoryPolicy(
      [proposal({ category: "resolution_attempt" })],
      "PRODUCT_NOT_RECEIVED",
      msgs("Jag vill ha pengarna tillbaka."),
    );
    expect(r.proposals[0].category).toBe("refund_history");
  });

  it("a merchant offering a refund is not re-routed as a customer request", () => {
    const r = applyFamilyCategoryPolicy(
      [proposal({ category: "resolution_attempt" })],
      "PRODUCT_NOT_RECEIVED",
      msgs("We can refund you if the parcel does not arrive.", "merchant"),
    );
    expect(r.proposals[0].category).toBe("resolution_attempt");
  });

  it("keeps an acknowledgement of receipt", () => {
    const p = proposal({ category: "delivery_recognition", explanation: "Customer says the parcel arrived." });
    const r = applyFamilyCategoryPolicy([p], "PRODUCT_NOT_RECEIVED", msgs("Got it today, thanks!"));
    expect(r.proposals).toEqual([p]);
  });
});

describe("applyFamilyCategoryPolicy — other families", () => {
  it("test 14: a genuine fraud-family contradiction stays contradiction", () => {
    const p = proposal({ explanation: "The customer discusses the purchase as their own." });
    const r = applyFamilyCategoryPolicy(
      [p],
      "FRAUDULENT",
      msgs("I ordered this for my sister, can I get a refund instead?"),
    );
    expect(r.proposals).toEqual([p]);
    expect(r.rejectedCount).toBe(0);
    expect(r.reroutedCount).toBe(0);
  });
});
