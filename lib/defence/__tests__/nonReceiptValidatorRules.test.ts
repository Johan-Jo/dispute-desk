/**
 * Non-receipt letters, validator layer (VALIDATOR_VERSION 5).
 * docs/plans/non-receipt-delivery-evidence.plan.md §4.1(c), §6.3, §6.6.
 *
 * The sentences below are verbatim or near-verbatim from the two live letters
 * that motivated the change (blume-box #360980, cay-collective #14784).
 */

import { describe, it, expect } from "vitest";
import { runPhraseAndGuardChecks } from "../validateNarrative";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import { credit_not_processed_family } from "../reasonCodes/families/credit_not_processed";
import {
  internalConstraintViolations,
  NO_INTERNAL_CONSTRAINTS,
  type InternalNarrativeConstraints,
} from "../internalConstraints";

const REQUESTED: InternalNarrativeConstraints = {
  refundOrCompensationRequested: { messageIds: ["cf7b6536"], firstSentAt: "2026-09-05T16:15:25Z" },
};

function check(text: string, family = item_not_received, constraints = NO_INTERNAL_CONSTRAINTS) {
  return runPhraseAndGuardChecks({
    text,
    sectionKey: "executiveSummary",
    approvedFacts: [],
    packageMode: "full",
    layer: "narrative",
    extraHardPhrases: family.prohibitedBankPhrases,
    guardedPhrases: family.guardedBankPhrases,
    internalConstraints: constraints,
  }).filter((e) => e.rule === "forbidden_phrase");
}

describe("item-not-received: no argument from the absence of a return", () => {
  it.each([
    // Case A, verbatim.
    "The absence of any return activity is inconsistent with a genuine non-receipt claim.",
    "no return, refund request, or merchandise recovery has been initiated by the cardholder",
    // Case B, verbatim.
    "The merchant notes that no return of the goods has been initiated and the carrier has not recorded any return transit event.",
    // Paraphrases.
    "The customer has not returned the item.",
    "The goods were never returned to the merchant.",
    "A return was not initiated at any point.",
    "No return request exists on the order.",
  ])("refuses: %s", (text) => {
    expect(check(text).length).toBeGreaterThan(0);
  });

  it("does not ban the same sentences in the credit-not-processed family (where the argument can be licensed)", () => {
    expect(check("The customer has not returned the item.", credit_not_processed_family)).toEqual([]);
  });

  it("passes a carrier-record sentence with no return reasoning", () => {
    expect(
      check(
        "PostNord records the shipment as collected at the pickup point on 18 September 2026 (tracking 00573132901924649740).",
      ),
    ).toEqual([]);
  });
});

describe("item-not-received: no collector or identity claims (§6.3)", () => {
  it.each([
    "The parcel was collected by the cardholder at the pickup point.",
    "It was collected by the customer on 18 September.",
    "The shipment was received by the recipient.",
    "The cardholder now has the goods.",
    "The customer collected the parcel.",
    "Identity was verified at collection.",
    "ID required at collection.",
  ])("refuses: %s", (text) => {
    expect(check(text).length).toBeGreaterThan(0);
  });

  it("passes the carrier's own record of collection and a named signer", () => {
    expect(check("PostNord records the shipment as collected at the pickup point on 18 September.")).toEqual([]);
    expect(check("The carrier records the parcel as signed for by A. Svensson on 18 September.")).toEqual([]);
  });
});

describe("raw carrier-status and proof-type enums are banned in every family (§6.6)", () => {
  it.each([
    "The carrier subsequently recorded a CollectedAtPickup status event on 18 September.",
    "Status: DeliveredToPickup.",
    "The proof type is delivered_confirmed.",
    "The shipment is in_transit.",
  ])("refuses: %s", (text) => {
    expect(check(text, credit_not_processed_family).length).toBeGreaterThan(0);
  });

  it("lower-case English prose is not an enum", () => {
    expect(check("The parcel was delivered to a pickup point and collected.", credit_not_processed_family)).toEqual([]);
  });
});

describe("refund-request denials", () => {
  const denials = [
    "No refund request has been made by the cardholder.",
    "The cardholder has not requested a refund.",
    "The customer never asked for a reimbursement.",
  ];

  it.each(denials)("item-not-received refuses it unconditionally: %s", (text) => {
    expect(check(text).length).toBeGreaterThan(0);
  });

  it.each(denials)("another family refuses it only under the internal constraint: %s", (text) => {
    expect(check(text, credit_not_processed_family, NO_INTERNAL_CONSTRAINTS)).toEqual([]);
    expect(check(text, credit_not_processed_family, REQUESTED).length).toBeGreaterThan(0);
  });

  it("the constraint does not refuse a sentence that merely mentions refunds", () => {
    expect(internalConstraintViolations("A refund has been processed on this charge.", "conclusion", REQUESTED)).toEqual([]);
  });
});

describe("delivery after the dispute: no sentence may relate the two (§6.6 rule 2)", () => {
  const POST: InternalNarrativeConstraints = { refundOrCompensationRequested: null, deliveryPostDatesDispute: true };
  const chk = (text: string, c: InternalNarrativeConstraints) =>
    runPhraseAndGuardChecks({
      text,
      sectionKey: "chronologyArgument",
      approvedFacts: [],
      packageMode: "full",
      layer: "narrative",
      internalConstraints: c,
    }).filter((e) => e.rule === "forbidden_phrase");

  it.each([
    // cay-collective #14784 v3, verbatim (opened 13 Sep, delivered 18 Sep).
    "establishing that the delivery event had been recorded by the carrier prior to the dispute being raised.",
    "The parcel was delivered before the claim was filed.",
    "The shipment was collected after the dispute was opened.",
    "Following the chargeback, the carrier recorded delivery.",
  ])("refuses: %s", (text) => {
    expect(chk(text, POST).length).toBeGreaterThan(0);
  });

  it("passes the carrier record without any dispute timing", () => {
    expect(chk("PostNord SE recorded delivery of the shipment on 18 September 2026 at 16:23 UTC.", POST)).toEqual([]);
  });

  it("does not apply when delivery preceded the dispute (then it is true and helps)", () => {
    expect(chk("The parcel was delivered before the claim was filed.", NO_INTERNAL_CONSTRAINTS)).toEqual([]);
  });

  it("deliveryPostDatesDispute compares every cited delivery date with the opening date", async () => {
    const { deliveryPostDatesDispute } = await import("../internalConstraints");
    const f = (d: string) => ({ category: "delivery_proof", value: { deliveredAt: d } });
    expect(deliveryPostDatesDispute([f("2026-09-18T16:23:00Z")], "2026-09-13T12:43:49Z")).toBe(true);
    expect(deliveryPostDatesDispute([f("2026-07-06T00:00:00Z")], "2026-09-19T00:15:40Z")).toBe(false);
    expect(deliveryPostDatesDispute([], "2026-09-13T12:43:49Z")).toBe(false);
    expect(deliveryPostDatesDispute([f("2026-09-18T16:23:00Z")], null)).toBe(false);
  });
});
