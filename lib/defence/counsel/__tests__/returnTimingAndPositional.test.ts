/**
 * Two deterministic letter checks (whj8db-1q #24285, package v21, 2026-11-10).
 *
 * v21 passed every check and carried two wrong sentences:
 *   1. "... a further order was placed one day after the dispute was opened and
 *      before any return was recorded." No return was ever recorded; "before"
 *      reads as if one came later. The ledger claim's mustNot already said "no
 *      date or timing word"; nothing enforced it.
 *   2. "... as shown in the order card above." The card prints on a later page.
 */
import { describe, expect, it } from "vitest";

import { CREDIT_NOT_PROCESSED_BRIEF } from "../briefs";
import { checkDraft, isReturnStatement, type CheckContext } from "../checks";
import { buildCreditNotProcessedLedger } from "../creditNotProcessedLedger";
import { disputeFrame, requestLine } from "../frame";
import { classifyIssue, issueEvidence } from "../issueRules";
import { NOT_AS_DESCRIBED } from "../playbooks";
import type { EvidenceFact } from "../../types";
import type { CounselDraft, EvidenceSectionKey, LedgerInput } from "../types";

const REAL_CONCLUSION =
  "Hem & Trend shipped the order the day it was placed, the carrier recorded delivery, and a further order was placed one day after the dispute was opened and before any return was recorded.";
const REAL_SHIPPING =
  "The same customer account then placed a further order one day after the dispute was opened, as shown in the order card above.";
const ALLOWED = "No return has been recorded in Shopify for this order.";

const frame = disputeFrame({ paymentFamily: "klarna", paymentLabel: "Klarna", phase: "inquiry" });
const FACTS = [
  { id: "order_confirmation#0", category: "order_record", value: { fieldKey: "order_confirmation" } },
  { id: "delivery#0", category: "delivery_proof", value: { proofType: "delivered_confirmed", carrier: "PostNord", trackingNumber: "PN1", deliveredAt: "2026-10-17T14:55:00Z" } },
  { id: "no_return_initiated#0", category: "no_return_initiated", value: { returnStatus: "NO_RETURN", returnInitiated: false } },
] as unknown as EvidenceFact[];

function input(over: Partial<LedgerInput> = {}): LedgerInput {
  return {
    moduleKey: "credit_not_processed",
    facts: FACTS,
    orderName: "#17615",
    disputeOpenedAt: "2026-10-30T08:35:00Z",
    disputeAmount: 2600,
    disputeCurrency: "SEK",
    customerOrders: [],
    packSections: [
      { type: "order", source: "shopify_order", data: { orderName: "#17615", createdAt: "2026-10-14T12:10:00Z" } },
      { type: "order", source: "shopify_order", data: { returnStatus: "NO_RETURN" } },
      {
        type: "shipping",
        source: "shopify_fulfillments",
        data: {
          fulfillments: [{ createdAt: "2026-10-15T15:33:00Z", deliveredAt: "2026-10-17T14:55:00Z", shipmentProofType: "delivered_confirmed", tracking: [{ number: "PN1", carrier: "PostNord" }] }],
        },
      },
    ],
    ...over,
  };
}

const ledger = buildCreditNotProcessedLedger(input())!;
const ctx: CheckContext = {
  ledger,
  playbook: NOT_AS_DESCRIBED,
  brief: CREDIT_NOT_PROCESSED_BRIEF,
  facts: FACTS,
  disputeOpenedAt: "2026-10-30T08:35:00Z",
  merchantName: "Hem & Trend",
  carrierName: "PostNord",
  pageIdentifiers: ["#17615", "17615"],
  trackingUrl: null,
  frame,
};

const SUMMARY = `The customer says a refund owed on this order was not processed. ${ALLOWED} The carrier recorded delivery of the order. ${requestLine(frame)}`;
const draft = (over: { summary?: string; conclusion?: string; sections?: Array<[EvidenceSectionKey, string]> } = {}): CounselDraft => ({
  summary: { paragraphs: [over.summary ?? SUMMARY], claimIds: ["claim_is_credit_not_processed", "no_return_recorded"] },
  evidenceSections: (over.sections ?? [["shipping", "The delivery on the shipment card is the carrier's own scan."]]).map(([key, text]) => ({ key, paragraphs: [text], claimIds: ["carrier_delivered"] })),
  conclusion: { paragraphs: [over.conclusion ?? `The order was delivered. ${ALLOWED} The claim that a refund is outstanding is not supported by the record.`], claimIds: ["carrier_delivered", "no_return_recorded"] },
});

const rules = (d: CounselDraft, c: CheckContext = ctx) => checkDraft(d, c).map((i) => classifyIssue(i).rule);
const NEW_RULES = ["truth.absence_with_timing", "truth.absence_placement", "copy.positional_reference"];
const newRules = (d: CounselDraft, c: CheckContext = ctx) => rules(d, c).filter((r) => NEW_RULES.includes(r));

describe("the no-return statement (A)", () => {
  it("fails the real v21 conclusion: a timing relation on a fact that never happened", () => {
    const issues = checkDraft(draft({ conclusion: REAL_CONCLUSION }), ctx);
    const hit = issues.find((i) => classifyIssue(i).rule === "truth.absence_with_timing");
    expect(hit).toBeTruthy();
    expect(classifyIssue(hit!)).toMatchObject({ section: "conclusion" });
  });

  it("keeps the allowed form passing, in the summary and again in the conclusion", () => {
    expect(newRules(draft())).toEqual([]);
    expect(checkDraft(draft(), ctx).filter((i) => /return|absence/i.test(i))).toEqual([]);
  });

  it.each([
    "No return has been recorded since the delivery.",
    "A further order was placed before any return was recorded.",
    "The order was delivered without a return being recorded.",
    "No return was initiated after the dispute was opened.",
    "No return was recorded within the policy period.",
    "No return has been recorded yet.",
    "No return has been recorded in Shopify for this order, and the carrier recorded delivery.",
    "Delivery was recorded; no return was made.",
  ])("fails the phrasing: %s", (sentence) => {
    expect(newRules(draft({ conclusion: sentence }))).toContain("truth.absence_with_timing");
  });

  it("fails the statement in an evidence section", () => {
    const d = draft({ sections: [["shipping", ALLOWED]] });
    expect(newRules(d)).toContain("truth.absence_placement");
    expect(checkDraft(d, ctx).find((i) => classifyIssue(i).rule === "truth.absence_placement")).toMatch(/^shipping: /);
  });

  it("does not fire where the ledger has no such claim", () => {
    const without = { ...ctx, ledger: ledger.filter((c) => c.id !== "no_return_recorded") };
    const d = draft({ conclusion: "The order was delivered before any return window opened. A return made later would be handled under the policy." });
    expect(newRules(d, without)).toEqual([]);
  });

  it("does not take a return policy for a return statement", () => {
    expect(isReturnStatement("The store has a return policy, published on the store.", true)).toBe(false);
    expect(isReturnStatement("The return period is described in the refund policy.", true)).toBe(false);
    expect(isReturnStatement("The order was delivered.", true)).toBe(false);
  });

  it("stores the offending sentence with the rule (outcome_detail.counsel.rejected)", () => {
    const [ev] = issueEvidence(checkDraft(draft({ conclusion: REAL_CONCLUSION }), ctx).filter((i) => classifyIssue(i).rule === "truth.absence_with_timing"));
    expect(ev.detail.text).toBe(REAL_CONCLUSION);
    expect(ev.rule).toBe("truth.absence_with_timing");
  });
});

describe("positional references (B)", () => {
  it("fails the real v21 shipping sentence", () => {
    const d = draft({ sections: [["shipping", REAL_SHIPPING]] });
    const hit = checkDraft(d, ctx).find((i) => classifyIssue(i).rule === "copy.positional_reference");
    expect(hit).toBeTruthy();
    expect(issueEvidence([hit!])[0]).toMatchObject({ section: "shipping", detail: { text: REAL_SHIPPING } });
  });

  it.each([
    "The table above lists the items.",
    "The carrier's record is below.",
    "The order card is set out overleaf.",
    "The card is on the next page.",
    "The card was on the previous page.",
    "As shown in the shipment card, the parcel was delivered.",
    "See below for the tracking record.",
  ])("fails: %s", (sentence) => {
    expect(newRules(draft({ sections: [["shipping", sentence]] }))).toContain("copy.positional_reference");
  });

  it("fails in the summary and the conclusion too", () => {
    expect(newRules(draft({ summary: SUMMARY.replace("The carrier recorded", "The timeline below shows the carrier recorded") }))).toContain("copy.positional_reference");
    expect(newRules(draft({ conclusion: `The card above shows delivery. ${ALLOWED}` }))).toContain("copy.positional_reference");
  });

  it("lets an exhibit be named by what it is", () => {
    const d = draft({ sections: [["shipping", "The carrier's tracking record shows delivery, and the customer's later order follows it."]] });
    expect(newRules(d)).toEqual([]);
  });
});
