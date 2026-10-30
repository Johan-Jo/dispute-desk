/**
 * Credit not processed has its own brief (2026-10-30).
 *
 * Regression: cay-collective #17615 (a Klarna inquiry) carried a strong
 * `no_return_initiated` fact that three sections cited by id and none stated.
 * The type had no brief, so it fell to the general brief, which has no claim
 * for returns: the writer argued "delivered, sale completed" against a refund
 * claim, and the one fact that answers it never reached the letter.
 */
import { describe, expect, it } from "vitest";

import { CREDIT_NOT_PROCESSED_BRIEF, GENERAL_BRIEF, briefForModule } from "../briefs";
import { checkDraft, type CheckContext } from "../checks";
import { buildCreditNotProcessedLedger } from "../creditNotProcessedLedger";
import { disputeFrame, requestLine } from "../frame";
import { writeLetter, type ModelCall } from "../generate";
import { NOT_AS_DESCRIBED } from "../playbooks";
import { ledgerForBrief } from "../run";
import type { EvidenceFact } from "../../types";
import type { CounselDraft, LedgerInput } from "../types";

const frame = disputeFrame({ paymentFamily: "klarna", paymentLabel: "Klarna", phase: "inquiry" });

const FACTS = [
  { id: "order_confirmation#0", category: "order_record", value: { fieldKey: "order_confirmation" } },
  { id: "delivery#0", category: "delivery_proof", value: { proofType: "delivered_confirmed", carrier: "PostNord", trackingNumber: "PN1", deliveredAt: "2026-10-17T14:55:00Z" } },
  { id: "no_return_initiated#0", category: "no_return_initiated", value: { returnStatus: "NO_RETURN", returnInitiated: false } },
  { id: "refund_policy#0", category: "policy_refund", value: { fieldKey: "refund_policy", publishedOnStore: true, publishedUrl: "https://store.example/policies/refund" } },
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
          fulfillments: [
            { createdAt: "2026-10-15T15:33:00Z", deliveredAt: "2026-10-17T14:55:00Z", shipmentProofType: "delivered_confirmed", tracking: [{ number: "PN1", carrier: "PostNord" }] },
          ],
        },
      },
    ],
    ...over,
  };
}

const ids = (i: LedgerInput) => buildCreditNotProcessedLedger(i)?.map((c) => c.id) ?? [];

describe("brief selection", () => {
  it("the credit_not_processed module gets its own brief, not the general one", () => {
    expect(briefForModule("credit_not_processed")).toBe(CREDIT_NOT_PROCESSED_BRIEF);
    expect(briefForModule("credit_not_processed")).not.toBe(GENERAL_BRIEF);
  });

  it("a case with a recorded absence and a delivery reaches that brief, theory first", () => {
    const got = ledgerForBrief(CREDIT_NOT_PROCESSED_BRIEF, input(), null)!;
    expect(got.brief.type).toBe("credit_not_processed");
    expect(got.ledger.map((c) => c.id)).toEqual(
      expect.arrayContaining(["claim_is_credit_not_processed", "no_return_recorded", "refund_policy_published", "carrier_delivered"]),
    );
  });

  it("a case with neither a recorded absence nor a delivery falls to the general brief", () => {
    const bare = input({ facts: [], packSections: [{ type: "order", source: "shopify_order", data: { orderName: "#17615", createdAt: "2026-10-14T12:10:00Z" } }] });
    expect(ledgerForBrief(CREDIT_NOT_PROCESSED_BRIEF, bare, null)!.brief.type).toBe("general");
  });
});

describe("the ledger", () => {
  it("carries the recorded absence, the published policy and the sequence — and nothing from not-as-described", () => {
    const got = ids(input());
    expect(got).toEqual(
      expect.arrayContaining(["claim_is_credit_not_processed", "shipped", "carrier_delivered", "dispute_after_delivery", "no_return_recorded", "refund_policy_published"]),
    );
    expect(got).not.toContain("claim_is_not_as_described");
    expect(got).not.toContain("listing_published");
  });

  it("states the absence in the module's own words", () => {
    const c = buildCreditNotProcessedLedger(input())!.find((x) => x.id === "no_return_recorded")!;
    expect(c.statement).toBe("No return has been recorded in Shopify for this order.");
    expect(c.sources).toContain("no_return_initiated#0");
  });

  it("makes no absence claim without the collector's no_return_initiated fact (a refund may exist)", () => {
    const withoutFact = input({ facts: FACTS.filter((f) => f.category !== "no_return_initiated") });
    expect(ids(withoutFact)).not.toContain("no_return_recorded");
    expect(ids(withoutFact)).toContain("carrier_delivered");
  });

  it("makes no absence claim when the order's return status is not NO_RETURN", () => {
    const i = input();
    i.packSections = i.packSections.map((s) => (s.data && "returnStatus" in (s.data as object) ? { ...s, data: { returnStatus: "RETURNED" } } : s));
    expect(ids(i)).not.toContain("no_return_recorded");
  });

  it("withholds the absence when a stored message shows a return or refund was asked for", () => {
    const got = buildCreditNotProcessedLedger(input(), { constraints: { returnRequested: true, refundOrCompensationRequested: null } })!;
    expect(got.map((c) => c.id)).not.toContain("no_return_recorded");
  });

  it("states the policy only as published, with a private limit against its terms", () => {
    const c = buildCreditNotProcessedLedger(input())!.find((x) => x.id === "refund_policy_published")!;
    expect(c.statement).toBe("The store's refund policy is published on the store.");
    expect(c.mustNot.join(" ")).toMatch(/never say what it requires/i);
  });

  it("drops the policy claim when the policy is not published on the store", () => {
    const unpublished = input({ facts: FACTS.map((f) => (f.category === "policy_refund" ? ({ ...f, value: { publishedOnStore: false } } as unknown as EvidenceFact) : f)) });
    expect(ids(unpublished)).not.toContain("refund_policy_published");
  });
});

describe("the checks", () => {
  const ledger = buildCreditNotProcessedLedger(input())!;
  const ctx: CheckContext = {
    ledger,
    playbook: NOT_AS_DESCRIBED,
    brief: CREDIT_NOT_PROCESSED_BRIEF,
    facts: FACTS,
    disputeOpenedAt: "2026-10-30T08:35:00Z",
    merchantName: "Cay Collective",
    carrierName: "PostNord",
    pageIdentifiers: ["#17615", "17615"],
    trackingUrl: null,
    frame,
  };
  const request = requestLine(frame);
  const good: CounselDraft = {
    summary: {
      paragraphs: [
        "The customer says a refund owed on this order was not processed. No return has been recorded in Shopify for this order. " +
          "The store's refund policy is published on the store, and the carrier recorded delivery of the order before the dispute was opened. " +
          `The claim that a refund is outstanding is not supported by the record. ${request}`,
      ],
      claimIds: ["claim_is_credit_not_processed", "no_return_recorded", "refund_policy_published", "carrier_delivered"],
    },
    evidenceSections: [{ key: "shipping", paragraphs: ["The delivery shown on the card above is the carrier's own scan."], claimIds: ["carrier_delivered"] }],
    conclusion: {
      paragraphs: ["The order was delivered, and no return is recorded in Shopify. The claim that a refund is outstanding is not supported by the record."],
      claimIds: ["carrier_delivered", "no_return_recorded"],
    },
  };

  it("accepts the absence in the summary and again in the conclusion", () => {
    expect(checkDraft(good, ctx)).toEqual([]);
  });

  it("refuses a third mention", () => {
    const three: CounselDraft = {
      ...good,
      evidenceSections: [{ key: "shipping", paragraphs: ["No return has been recorded in Shopify for this order."], claimIds: ["no_return_recorded"] }],
    };
    expect(checkDraft(three, ctx).join("\n")).toMatch(/recorded absence appears 3 times/);
  });

  it("still refuses an absence beside a timing clause", () => {
    const timed: CounselDraft = { ...good, conclusion: { paragraphs: ["No return has been recorded in Shopify since the delivery."], claimIds: ["no_return_recorded"] } };
    expect(checkDraft(timed, ctx).join("\n")).toMatch(/shares a sentence with a timing clause/);
  });

  it.each([
    ["no refund was owed", "The merchant states that no refund was owed on this order."],
    ["what the customer did", "The customer did not return the goods."],
    ["the customer accepting the policy", "The customer accepted the refund policy at checkout."],
    ["what the policy requires", "The refund policy requires a return within thirty days."],
  ])("refuses a letter that says %s", (_name, sentence) => {
    const bad: CounselDraft = { ...good, evidenceSections: [{ key: "shipping", paragraphs: [sentence], claimIds: ["carrier_delivered"] }] };
    expect(checkDraft(bad, ctx).join("\n")).toMatch(/breaks the limit/);
  });
});

describe("the writer end to end (stubbed model)", () => {
  const ledger = buildCreditNotProcessedLedger(input())!;
  const request = requestLine(frame);
  const reply = JSON.stringify({
    summary: [
      "The customer says a refund owed on this order was not processed. No return has been recorded in Shopify for this order. " +
        "The store's refund policy is published on the store, and the carrier recorded delivery of the order before the dispute was opened. " +
        `The claim that a refund is outstanding is not supported by the record. ${request}`,
    ],
    summaryClaimIds: ["claim_is_credit_not_processed", "no_return_recorded", "refund_policy_published", "carrier_delivered"],
    sections: { shipping: { text: "The delivery shown on the card above is the carrier's own scan.", claimIds: ["carrier_delivered"] } },
    conclusion: {
      text: "The order was delivered, and no return is recorded in Shopify. The claim that a refund is outstanding is not supported by the record.",
      claimIds: ["carrier_delivered", "no_return_recorded"],
    },
  });
  const CLEAN = JSON.stringify({ errors: [], unclear: [] });

  it("writes a letter whose summary and conclusion both state the no-return fact", async () => {
    const seen: string[] = [];
    const call: ModelCall = async ({ stage, user }) => {
      seen.push(stage);
      if (stage === "write") {
        // The writer is told what the case argues from, and which claims it holds.
        expect(user).toContain("THEORY OF THE CASE (no_return_policy_delivered)");
        expect(user).toContain("no_return_recorded [strong]");
        expect(user).toContain("THE CLAIM: a refund or credit owed to the customer was not processed.");
      }
      return stage === "write" ? reply : CLEAN;
    };
    const r = await writeLetter({
      ledger,
      brief: CREDIT_NOT_PROCESSED_BRIEF,
      frame,
      merchantName: "Cay Collective",
      pageContext: "Header: …",
      check: {
        ledger,
        playbook: NOT_AS_DESCRIBED,
        brief: CREDIT_NOT_PROCESSED_BRIEF,
        facts: FACTS,
        disputeOpenedAt: "2026-10-30T08:35:00Z",
        merchantName: "Cay Collective",
        carrierName: "PostNord",
        pageIdentifiers: ["#17615", "17615"],
        trackingUrl: null,
        frame,
      },
      call,
    });
    expect(seen).toEqual(["write", "review"]);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.theory.name).toBe("no_return_policy_delivered");
    expect(r.draft.summary.paragraphs.join(" ")).toContain("No return has been recorded in Shopify for this order.");
    expect(r.draft.conclusion.paragraphs.join(" ")).toMatch(/no return is recorded in Shopify/);
  });
});
