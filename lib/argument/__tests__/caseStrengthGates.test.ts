/**
 * Gate behaviour through `calculateCaseStrength` — coverage,
 * fatal-loss, risk-weakness, credit-already-issued, and their
 * precedence when several fire at once.
 *
 * WHY THIS FILE EXISTS. Only the name-mismatch gate had direct
 * engine-level tests; the other four were exercised solely through
 * `buildPack` and through production data. The parity harness
 * (`scripts/case-strength-parity.mjs`, plan §6.1) made that concrete: of
 * 209 prod packs, exactly ONE has a fatal-loss verdict, exactly ONE has a
 * credit-already-issued block, ZERO are covered by Shopify Protect, and
 * ZERO carry two triggered gates at once. Real data cannot cover these
 * paths, so they are covered synthetically here — the "hand-build the
 * shortfall and say so" half of the plan's sampling rule.
 *
 * These pin CURRENT behaviour (the gates refactor changed no logic).
 */

import { describe, expect, it } from "vitest";
import { calculateCaseStrength } from "../caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { NO_GATES, gatesWith } from "@/tests/helpers/caseStrengthGates";

function item(field: string): ChecklistItemV2 {
  return {
    field,
    label: field,
    status: "available",
    collectionType: "automatic",
    priority: "recommended",
    blocking: false,
    source: "template",
  } as unknown as ChecklistItemV2;
}

/** Scores weak on its own: one supporting-only signal, nothing decisive. */
const weakChecklist = (): ChecklistItemV2[] => [item("order_confirmation")];
const weakPayload = {
  kind: "byField" as const,
  map: { order_confirmation: { payload: {} } },
};

/** Scores strong on its own (fraud family): AVS + delivery + device. */
const strongChecklist = (): ChecklistItemV2[] => [
  item("avs_cvv_match"),
  item("shipping_tracking"),
  item("device_session_consistency"),
];
const strongPayload = {
  kind: "byField" as const,
  map: {
    avs_cvv_match: { payload: { avsResultCode: "Y", cvvResultCode: "M" } },
    shipping_tracking: {
      payload: {
        proofType: "delivered_confirmed",
        deliveredToVerifiedAddress: true,
        deliveredAt: "2026-07-10T12:00:00Z",
        fulfillments: [],
      },
    },
    device_session_consistency: {
      payload: { consistent: true, loginPresent: true, ipMatch: true },
    },
  },
};

const COVERED = {
  state: "covered_shopify" as const,
  shopifyProtectStatus: "PROTECTED" as const,
};
const FATAL = {
  triggered: true,
  reason: "refund_issued" as const,
  messageToken: { key: "disputes.strengthReason.fatalLoss.refund_issued" },
};
const CREDIT_FULL = { triggered: true, coversDisputedAmount: true };
const RISK = {
  triggered: true,
  reason: "high_risk_fulfilled" as const,
  message: null,
  diagnostics: { riskLevel: "HIGH", recommendation: "CANCEL", fulfillmentCount: 1 },
};

/* ── Baseline: no gate changes anything ── */

describe("gate-free baseline", () => {
  it("scores on evidence alone", () => {
    const r = calculateCaseStrength(strongChecklist(), "FRAUDULENT", strongPayload, NO_GATES);
    expect(r.overall).toBe("strong");
    expect(r.heroVariant).toBe("likely_to_win");
    expect(r.coverage).toBeUndefined();
    expect(r.fatalLoss).toBeUndefined();
  });
});

/* ── Coverage Gate (PRD §4) ── */

describe("coverage gate", () => {
  it("forces the covered hero and reason, and suppresses the improvement hint", () => {
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({ coverage: COVERED }),
    );
    expect(r.heroVariant).toBe("covered");
    expect(r.strengthReasonI18n.key).toBe("disputes.strengthReason.covered");
    expect(r.improvementHintI18n).toBeNull();
    // Underlying scoring is untouched — diagnostics keep working.
    expect(r.overall).toBe("weak");
  });

  it("does not fire on not_covered", () => {
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({
        coverage: { state: "not_covered", shopifyProtectStatus: "NOT_PROTECTED" },
      }),
    );
    expect(r.heroVariant).not.toBe("covered");
    expect(r.strengthReasonI18n.key).not.toBe("disputes.strengthReason.covered");
  });

  it("covers an empty checklist too", () => {
    const r = calculateCaseStrength([], "FRAUDULENT", undefined, gatesWith({ coverage: COVERED }));
    expect(r.overall).toBe("insufficient");
    expect(r.heroVariant).toBe("covered");
    expect(r.strengthReasonI18n.key).toBe("disputes.strengthReason.covered");
  });
});

/* ── Fatal-loss Gate (PRD §5) ── */

describe("fatal-loss gate", () => {
  it("caps a strong case at weak and forces hard_to_win", () => {
    const r = calculateCaseStrength(
      strongChecklist(),
      "FRAUDULENT",
      strongPayload,
      gatesWith({ fatalLoss: FATAL }),
    );
    expect(r.overall).toBe("weak");
    expect(r.heroVariant).toBe("hard_to_win");
    expect(r.strengthReasonI18n.key).toBe("disputes.strengthReason.fatalLoss.refund_issued");
    expect(r.improvementHintI18n).toBeNull();
    // Counts are NOT rewritten — the evidence is still what it is.
    expect(r.strongCount).toBeGreaterThan(0);
  });

  it("is inert when not triggered", () => {
    const r = calculateCaseStrength(
      strongChecklist(),
      "FRAUDULENT",
      strongPayload,
      gatesWith({ fatalLoss: { triggered: false, reason: null, messageToken: null } }),
    );
    expect(r.overall).toBe("strong");
  });

  it("applies to an empty checklist", () => {
    const r = calculateCaseStrength([], "FRAUDULENT", undefined, gatesWith({ fatalLoss: FATAL }));
    expect(r.overall).toBe("weak");
    expect(r.heroVariant).toBe("hard_to_win");
  });
});

/* ── Credit-already-issued FLOOR ── */

describe("credit-already-issued floor", () => {
  it("lifts a weak case to strong when the credit covers the disputed amount", () => {
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({ creditAlreadyIssued: CREDIT_FULL }),
    );
    expect(r.overall).toBe("strong");
    expect(r.heroVariant).toBe("likely_to_win");
    expect(r.strengthReasonI18n.key).toBe("disputes.strengthReason.creditAlreadyIssued");
    // No "add delivery confirmation" on an order that was already refunded.
    expect(r.improvementHintI18n).toBeNull();
  });

  it("does NOT fire on a partial credit", () => {
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({ creditAlreadyIssued: { triggered: true, coversDisputedAmount: false } }),
    );
    expect(r.overall).toBe("weak");
  });

  it("does not add to the evidence counts — it is a floor, not a signal", () => {
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({ creditAlreadyIssued: CREDIT_FULL }),
    );
    expect(r.strongCount).toBe(0);
    expect(r.moderateCount).toBe(0);
  });
});

/* ── Risk-weakness: caps the HERO COPY, never the grade ──────────────
 *
 * 2026-05-15: received and recorded, no merchant-facing effect.
 * 2026-08-17 amendment (maintainer): the hero copy caps. Dispute
 * 11143315649 was rated strong (full AVS+CVV, name match) while
 * Shopify's pre-auth screening had said HIGH / CANCEL — and
 * stolen-card-with-correct-codes is exactly what card-testing looks
 * like, so "likely to win" overpromised on precisely these orders.
 * The grade stays (the evidence IS strong; the issuer weighs their own
 * auth data, not Shopify's score) and auto-mode still files. */

describe("risk-weakness gate", () => {
  it("propagates diagnostics without changing the verdict", () => {
    const r = calculateCaseStrength(
      strongChecklist(),
      "FRAUDULENT",
      strongPayload,
      gatesWith({ riskWeakness: RISK }),
    );
    expect(r.overall).toBe("strong");
    expect(r.riskWeakness).toEqual(RISK);
  });

  it("caps the hero at could_win on a strong case — the copy, not the grade", () => {
    const r = calculateCaseStrength(
      strongChecklist(),
      "FRAUDULENT",
      strongPayload,
      gatesWith({ riskWeakness: RISK }),
    );
    expect(r.overall).toBe("strong");
    expect(r.heroVariant).toBe("could_win");
  });

  it("leaves the hero at likely_to_win when it does NOT fire", () => {
    const r = calculateCaseStrength(strongChecklist(), "FRAUDULENT", strongPayload, gatesWith({}));
    expect(r.overall).toBe("strong");
    expect(r.heroVariant).toBe("likely_to_win");
  });

  it("does NOT cap a credit-already-issued case", () => {
    /* That win rests on the credit fact — the amount is already refunded —
     * not on whether the fraud claim is genuine, so the fraud prior the
     * HIGH flag encodes is irrelevant to it. */
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({ creditAlreadyIssued: CREDIT_FULL, riskWeakness: RISK }),
    );
    expect(r.heroVariant).toBe("likely_to_win");
  });

  it("does not disturb the weaker tiers, which never promised a win", () => {
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({ riskWeakness: RISK }),
    );
    expect(r.heroVariant).toBe("hard_to_win");
  });
});

/* ── Precedence when several gates fire (no prod case has two) ── */

describe("gate precedence", () => {
  it("coverage beats fatal-loss", () => {
    const r = calculateCaseStrength(
      strongChecklist(),
      "FRAUDULENT",
      strongPayload,
      gatesWith({ coverage: COVERED, fatalLoss: FATAL }),
    );
    expect(r.heroVariant).toBe("covered");
    expect(r.strengthReasonI18n.key).toBe("disputes.strengthReason.covered");
  });

  it("coverage beats the credit floor", () => {
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({ coverage: COVERED, creditAlreadyIssued: CREDIT_FULL }),
    );
    expect(r.heroVariant).toBe("covered");
    expect(r.overall).toBe("weak");
  });

  it("fatal-loss beats the credit floor", () => {
    const r = calculateCaseStrength(
      weakChecklist(),
      "FRAUDULENT",
      weakPayload,
      gatesWith({ fatalLoss: FATAL, creditAlreadyIssued: CREDIT_FULL }),
    );
    expect(r.overall).toBe("weak");
    expect(r.heroVariant).toBe("hard_to_win");
  });

  it("the credit floor outranks the name-mismatch cap", () => {
    // "A name mismatch does not make a full pre-dispute refund any less
    // of a refund" — the floor is about a different claim entirely.
    const r = calculateCaseStrength(
      strongChecklist(),
      "FRAUDULENT",
      strongPayload,
      gatesWith({
        creditAlreadyIssued: CREDIT_FULL,
        nameMismatch: {
          triggered: true,
          cardholderName: "Robin Denise Pipe",
          customerName: "Sean Boyd",
        },
      }),
    );
    expect(r.overall).toBe("strong");
    expect(r.heroVariant).toBe("likely_to_win");
  });

  it("all four gates at once resolves to coverage", () => {
    const r = calculateCaseStrength(
      strongChecklist(),
      "FRAUDULENT",
      strongPayload,
      gatesWith({
        coverage: COVERED,
        fatalLoss: FATAL,
        riskWeakness: RISK,
        creditAlreadyIssued: CREDIT_FULL,
      }),
    );
    expect(r.heroVariant).toBe("covered");
    expect(r.strengthReasonI18n.key).toBe("disputes.strengthReason.covered");
    expect(r.improvementHintI18n).toBeNull();
    // Every gate block still round-trips for audit.
    expect(r.coverage).toEqual(COVERED);
    expect(r.fatalLoss).toEqual(FATAL);
    expect(r.riskWeakness).toEqual(RISK);
  });
});
