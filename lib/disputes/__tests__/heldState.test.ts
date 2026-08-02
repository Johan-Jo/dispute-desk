/**
 * heldState — the derivation behind every "held" sentence a merchant reads.
 *
 * Two properties matter more than the individual cases:
 *   1. `held` tracks the SHARED guard verdict, so it cannot drift from what
 *      the pipeline actually did with the pack.
 *   2. `offer` tracks the acknowledgement card's own hide gate, so no surface
 *      can invite an action the dispute page hides (and vice versa).
 */

import { describe, it, expect } from "vitest";
import {
  canOfferCardholderAcknowledgement,
  communicationHasEvidenceFromChecklist,
  resolveHeldState,
} from "../heldState";

const OFFERABLE = {
  communicationHasEvidence: false,
  submissionState: "not_saved",
  finalOutcome: null,
};

function held(overrides: Record<string, unknown> = {}) {
  return resolveHeldState({
    automationMode: "auto",
    caseStrength: "moderate",
    coverageState: "not_covered",
    fatalLoss: null,
    acknowledgement: OFFERABLE,
    ...overrides,
  });
}

describe("resolveHeldState — when a case is held", () => {
  it("moderate in auto mode is held, and the offer can flip it to strong", () => {
    expect(held()).toEqual({
      held: true,
      reason: "moderate_strength",
      offer: "cardholder_acknowledgement",
      offerFlipsToStrong: true,
    });
  });

  it.each(["weak", "insufficient"])("%s in auto mode is held, without the flip promise", (s) => {
    // A weak case has no strong signal yet, so one acknowledgement reaches
    // strongCount = 1 → still not "strong". Promising an immediate save here
    // would be the same lie in a new place.
    const state = held({ caseStrength: s });
    expect(state.held).toBe(true);
    expect(state.reason).toBe("weak_strength");
    expect(state.offer).toBe("cardholder_acknowledgement");
    expect(state.offerFlipsToStrong).toBe(false);
  });

  it("strong is not held — the pipeline saves it", () => {
    expect(held({ caseStrength: "strong" }).held).toBe(false);
  });

  it("a legacy pack with no case_strength is not held", () => {
    expect(held({ caseStrength: null }).held).toBe(false);
  });

  it("review mode is never held — the merchant genuinely has to approve", () => {
    expect(held({ automationMode: "review" }).held).toBe(false);
    expect(held({ automationMode: null }).held).toBe(false);
  });

  it("Shopify Protect coverage is not held — it has its own copy", () => {
    expect(held({ coverageState: "covered_shopify" }).held).toBe(false);
  });

  it("fatal-loss is not held — no merchant evidence can move it", () => {
    expect(held({ fatalLoss: { triggered: true, reason: "refund_issued" } }).held).toBe(false);
  });

  it("a fully-credited transaction is not held — the guards proceed", () => {
    expect(
      held({
        caseStrength: "moderate",
        creditAlreadyIssued: { triggered: true, coversDisputedAmount: true },
      }).held,
    ).toBe(false);
  });
});

describe("resolveHeldState — the offer", () => {
  it("is absent when the merchant already provided customer communication", () => {
    const state = held({
      acknowledgement: { ...OFFERABLE, communicationHasEvidence: true },
    });
    expect(state.held).toBe(true);
    expect(state.offer).toBeNull();
    expect(state.offerFlipsToStrong).toBe(false);
  });

  it("is absent once Shopify has forwarded to the bank", () => {
    expect(
      held({ acknowledgement: { ...OFFERABLE, submissionState: "submitted_confirmed" } }).offer,
    ).toBeNull();
  });

  it("is absent on a terminal dispute", () => {
    expect(held({ acknowledgement: { ...OFFERABLE, finalOutcome: "lost" } }).offer).toBeNull();
  });

  it("is absent when the caller supplies no acknowledgement facts", () => {
    const state = held({ acknowledgement: null });
    expect(state.held).toBe(true);
    expect(state.offer).toBeNull();
  });
});

describe("canOfferCardholderAcknowledgement — the card's gate", () => {
  it("mirrors CardholderAcknowledgementCard: hasEvidence hides it, not strength", () => {
    // The card deliberately hides on `hasEvidence` rather than
    // `usedAsPositiveBankEvidence` — a provided conversation the categorizer
    // kept at supporting must not be re-requested.
    expect(canOfferCardholderAcknowledgement({ communicationHasEvidence: false })).toBe(true);
    expect(canOfferCardholderAcknowledgement({ communicationHasEvidence: true })).toBe(false);
  });
});

describe("communicationHasEvidenceFromChecklist", () => {
  it("reads the customer_communication row only", () => {
    expect(
      communicationHasEvidenceFromChecklist([
        { field: "avs_cvv_match", status: "available" },
        { field: "customer_communication", status: "missing" },
      ]),
    ).toBe(false);
  });

  it.each(["available", "waived"])("treats %s as provided", (status) => {
    expect(
      communicationHasEvidenceFromChecklist([{ field: "customer_communication", status }]),
    ).toBe(true);
  });

  it("treats an absent row (and an absent checklist) as nothing collected", () => {
    expect(communicationHasEvidenceFromChecklist([])).toBe(false);
    expect(communicationHasEvidenceFromChecklist(null)).toBe(false);
  });
});
