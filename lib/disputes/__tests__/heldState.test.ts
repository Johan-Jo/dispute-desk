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
  merchantSuppliedAcknowledgementFromItems,
  resolveHeldState,
} from "../heldState";

const OFFERABLE = {
  merchantSuppliedAcknowledgement: false,
  submissionState: "not_saved",
  finalOutcome: null,
};

function held(overrides: Record<string, unknown> = {}) {
  return resolveHeldState({
    automationMode: "auto",
    caseStrength: "moderate",
      creditAlreadyIssued: null,
    coverageState: "not_covered",
    fatalLoss: null,
    returnedToSender: null,
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
  it("is absent when the merchant already supplied an acknowledgement", () => {
    const state = held({
      acknowledgement: { ...OFFERABLE, merchantSuppliedAcknowledgement: true },
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
  it("hides on merchant-supplied work, not on strength", () => {
    // A paste the categorizer kept at `supporting` still counts as done —
    // the merchant must not be asked to redo it.
    expect(canOfferCardholderAcknowledgement({ merchantSuppliedAcknowledgement: false })).toBe(true);
    expect(canOfferCardholderAcknowledgement({ merchantSuppliedAcknowledgement: true })).toBe(false);
  });
});

/**
 * The distinction this helper exists to draw. Prod, 2026-08-02: 11 of
 * blume-box's 17 open WEAK disputes had `customer_communication` flipped to
 * `available` by an auto-collected `shopify_timeline` order note carrying no
 * `customerConfirmsOrder`. Those packs scored `strongCount: 0` — precisely
 * the cases an acknowledgement could move — and the old row-based gate hid
 * the CTA on every one of them.
 */
describe("merchantSuppliedAcknowledgementFromItems", () => {
  const TIMELINE_NOTE = {
    payload: { source: "shopify_timeline", fieldsProvided: ["customer_communication"] },
  };

  it("an auto-collected timeline note does NOT count as merchant-supplied", () => {
    expect(merchantSuppliedAcknowledgementFromItems([TIMELINE_NOTE])).toBe(false);
  });

  it("the acknowledgement form's own marker counts, whatever it scored", () => {
    // `kind` is written only by the cardholder-acknowledgement route, and is
    // present even when the discriminator failed to lift the row to strong.
    expect(
      merchantSuppliedAcknowledgementFromItems([
        TIMELINE_NOTE,
        { payload: { kind: "cardholder_acknowledgement" } },
      ]),
    ).toBe(true);
  });

  it("an explicit customerConfirmsOrder counts — e.g. an approved Gorgias thread", () => {
    expect(
      merchantSuppliedAcknowledgementFromItems([{ payload: { customerConfirmsOrder: true } }]),
    ).toBe(true);
  });

  it("is false for an empty, null, or payload-less item list", () => {
    expect(merchantSuppliedAcknowledgementFromItems([])).toBe(false);
    expect(merchantSuppliedAcknowledgementFromItems(null)).toBe(false);
    expect(merchantSuppliedAcknowledgementFromItems([{ payload: null }])).toBe(false);
  });
});
