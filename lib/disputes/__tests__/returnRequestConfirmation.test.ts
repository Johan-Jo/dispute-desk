/**
 * Fix C (docs/plans/mein-maison-status-and-no-return.plan.md): returns
 * handled outside Shopify. Pins the scoring rule (C3), the fact scope the
 * collector writes (C1/C4b), the one attributed sentence and its guard
 * exemption, and the letter ledger.
 */
import { describe, expect, it } from "vitest";
import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import {
  MERCHANT_CONFIRMED_NO_REQUEST_SENTENCE,
  noReturnFactScope,
  packShowsReturnOrRefund,
  returnQuestionApplies,
  shopifyRecordsReturnOrRefund,
} from "@/lib/disputes/returnRequestConfirmation";
import { runClaimGuards } from "@/lib/defence/claimGuards";
import { buildNotAsDescribedLedger } from "@/lib/defence/counsel/notAsDescribedLedger";
import { buildRecordSections } from "@/lib/defence/counsel/recordSections";
import { NOT_AS_DESCRIBED } from "@/lib/defence/counsel/playbooks";
import type { EvidenceFact, NarrativeSectionKey } from "@/lib/defence/types";
import type { LedgerInput } from "@/lib/defence/counsel/types";

describe("C3 scoring: the Shopify record alone does not count for an email-returns shop", () => {
  it("setting off: unchanged (moderate)", () => {
    expect(categorizeEvidenceField("no_return_initiated", { returnStatus: "NO_RETURN" })).toBe("moderate");
  });
  it("setting on, unanswered: supporting only", () => {
    expect(
      categorizeEvidenceField("no_return_initiated", { returnStatus: "NO_RETURN", returnsOutsideShopify: true }),
    ).toBe("supporting");
  });
  it("setting on, merchant confirmed no request: today's weight", () => {
    expect(
      categorizeEvidenceField("no_return_initiated", {
        returnStatus: "NO_RETURN",
        returnsOutsideShopify: true,
        merchantConfirmedNoRequest: true,
      }),
    ).toBe("moderate");
  });
});

describe("C1/C4b fact scope", () => {
  it("the customer DID ask: the fact is not emitted at all", () => {
    expect(noReturnFactScope({ returnsOutsideShopify: true, answer: "request_received" }).emit).toBe(false);
  });
  it("not sure = unanswered", () => {
    expect(noReturnFactScope({ returnsOutsideShopify: true, answer: "not_sure" })).toEqual({
      emit: true,
      returnsOutsideShopify: true,
      merchantConfirmedNoRequest: false,
    });
  });
  it("confirmed no request carries the flag", () => {
    expect(noReturnFactScope({ returnsOutsideShopify: true, answer: "no_request_received" }).merchantConfirmedNoRequest).toBe(true);
  });
  it("the question applies only with the setting on and a family where it matters", () => {
    expect(returnQuestionApplies({ returnsOutsideShopify: true, reasonFamily: "product" })).toBe(true);
    expect(returnQuestionApplies({ returnsOutsideShopify: true, reasonFamily: "refund" })).toBe(true);
    expect(returnQuestionApplies({ returnsOutsideShopify: true, reasonFamily: "delivery" })).toBe(true);
    expect(returnQuestionApplies({ returnsOutsideShopify: true, reasonFamily: "fraud" })).toBe(false);
    expect(returnQuestionApplies({ returnsOutsideShopify: false, reasonFamily: "product" })).toBe(false);
  });
});

function fact(value: Record<string, unknown>): EvidenceFact {
  return {
    id: "f-nr",
    category: "no_return_initiated",
    label: "No return recorded in Shopify",
    value,
    source: "shopify_order",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  };
}

function sections(text: string): Record<NarrativeSectionKey, { text: string }> {
  return {
    executiveSummary: { text: "" },
    transactionOverviewArgument: { text: "" },
    chronologyArgument: { text: "" },
    paymentAuthenticationArgument: { text: "" },
    fulfillmentArgument: { text: text },
    communicationArgument: { text: "" },
    policyArgument: { text: "" },
    manualEvidenceArgument: { text: "" },
    conclusion: { text: "" },
  } as Record<NarrativeSectionKey, { text: string }>;
}

describe("C4b: the question is not asked when Shopify already records a refund or return", () => {
  // Live case 2026-10-02: PRODUCT_UNACCEPTABLE dispute opened two days after
  // a €22.46 refund in Shopify; the card still asked "did the customer ask?".
  const orderSection = (data: Record<string, unknown>) => ({
    type: "order",
    labelToken: { key: "packs.section.order", params: { orderName: "#1" } },
    data,
  });

  it("a refund or any return status other than NO_RETURN counts", () => {
    expect(shopifyRecordsReturnOrRefund({ returnStatus: "NO_RETURN", totalRefunded: "22.46" })).toBe(true);
    expect(shopifyRecordsReturnOrRefund({ returnStatus: "RETURN_REQUESTED", totalRefunded: "0.00" })).toBe(true);
    expect(shopifyRecordsReturnOrRefund({ returnStatus: "RETURNED", totalRefunded: 0 })).toBe(true);
    expect(shopifyRecordsReturnOrRefund({ returnStatus: "NO_RETURN", totalRefunded: "0.00" })).toBe(false);
    expect(shopifyRecordsReturnOrRefund({ returnStatus: null, totalRefunded: null })).toBe(false);
  });

  it("reads the persisted order section (older packs: refund only)", () => {
    expect(packShowsReturnOrRefund([orderSection({ totals: { refunded: "22.46" } })])).toBe(true);
    expect(packShowsReturnOrRefund([orderSection({ totals: { refunded: "0.00" }, returnStatus: "IN_PROGRESS" })])).toBe(true);
    expect(packShowsReturnOrRefund([orderSection({ totals: { refunded: "0.00" }, returnStatus: "NO_RETURN" })])).toBe(false);
    expect(packShowsReturnOrRefund([orderSection({ totals: { refunded: "0.00" } })])).toBe(false);
    expect(packShowsReturnOrRefund(null)).toBe(false);
  });

  it("returnQuestionApplies is false whatever the setting and family", () => {
    expect(
      returnQuestionApplies({ returnsOutsideShopify: true, reasonFamily: "product", shopifyRecordsReturnOrRefund: true }),
    ).toBe(false);
  });
});

describe("C4b: the one attributed sentence", () => {
  const withSentence = `No return has been recorded in Shopify for this order. ${MERCHANT_CONFIRMED_NO_REQUEST_SENTENCE}`;

  it("passes when the no-return fact carries the merchant's confirmation", () => {
    const r = runClaimGuards({
      narrativeSections: sections(withSentence),
      approvedFacts: [fact({ returnInitiated: false, merchantConfirmedNoRequest: true })],
    });
    expect(r.failures).toEqual([]);
  });

  it("fails without the confirmation", () => {
    const r = runClaimGuards({
      narrativeSections: sections(withSentence),
      approvedFacts: [fact({ returnInitiated: false })],
    });
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it("any other absence wording still fails, confirmation or not", () => {
    const r = runClaimGuards({
      narrativeSections: sections("The customer never contacted us about this order."),
      approvedFacts: [fact({ returnInitiated: false, merchantConfirmedNoRequest: true })],
    });
    expect(r.failures.map((f) => f.guardId)).toContain("contact_claim_beyond_record");
  });
});

describe("C4b: the letter ledger", () => {
  function input(noReturnData: Record<string, unknown>): LedgerInput {
    return {
      moduleKey: "product_unacceptable",
      facts: [],
      orderName: "#101111",
      disputeOpenedAt: "2026-09-26T14:40:38Z",
      disputeAmount: 85.46,
      disputeCurrency: "EUR",
      customerOrders: [],
      packSections: [
        { type: "order", source: "shopify_order", data: { orderName: "#101111", createdAt: "2026-09-06T10:36:58Z", lineItems: [{ title: "Robot" }] } },
        { type: "order", source: "shopify_order", data: noReturnData },
        {
          type: "shipping",
          source: "shopify_fulfillments",
          data: { fulfillments: [{ createdAt: "2026-09-07T06:07:54Z", deliveredAt: "2026-09-18T09:29:08Z", shipmentProofType: "delivered_confirmed" }] },
        },
      ],
    } as LedgerInput;
  }

  it("a confirmed answer adds the attributed sentence right after the no-return line", () => {
    const ledger = buildNotAsDescribedLedger(input({ returnStatus: "NO_RETURN", merchantConfirmedNoRequest: true }))!;
    expect(ledger.map((c) => c.id)).toContain("merchant_confirmed_no_request");
    const text = buildRecordSections(ledger, NOT_AS_DESCRIBED).evidenceSections.flatMap((s) => s.paragraphs).join(" ");
    expect(text).toContain(`No return has been recorded in Shopify for this order. ${MERCHANT_CONFIRMED_NO_REQUEST_SENTENCE}`);
  });

  it("without it the letter keeps only the Shopify-record sentence", () => {
    const ledger = buildNotAsDescribedLedger(input({ returnStatus: "NO_RETURN" }))!;
    expect(ledger.map((c) => c.id)).not.toContain("merchant_confirmed_no_request");
  });
});
