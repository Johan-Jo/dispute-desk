/**
 * The credit-already-issued strategy: registered everywhere, gated on a
 * VERIFIED pre-dispute credit, and outranking the family's own theory.
 *
 * Visa's Dispute Management Guidelines treat "credit already processed"
 * as a ground making the dispute invalid — it attaches to the
 * transaction, not to a reason code, which is why this is the one
 * strategy that is not family-specific.
 */

import { describe, expect, it } from "vitest";
import { STRATEGIES_BY_FAMILY, rankStrategies } from "../registry";
import { credit_already_issued } from "../credit_already_issued";
import { FACT_PREDICATES } from "../../factPredicates";
import type { EvidenceFact } from "../../types";

function refundFact(value: Record<string, unknown>): EvidenceFact {
  return {
    id: "f1",
    label: "Refund record",
    category: "refund_record",
    value,
    source: "shopify_order",
    strength: "strong",
  } as EvidenceFact;
}

describe("credit_already_issued registration", () => {
  it("is available to EVERY reason-code family", () => {
    for (const [family, strategies] of Object.entries(STRATEGIES_BY_FAMILY)) {
      expect(
        strategies.some((s) => s.key === "credit_already_issued"),
        `family ${family} is missing credit_already_issued`,
      ).toBe(true);
    }
  });

  it("outranks every other strategy in every family", () => {
    for (const strategies of Object.values(STRATEGIES_BY_FAMILY)) {
      for (const s of strategies) {
        if (s.key === "credit_already_issued") continue;
        expect(s.priority).toBeLessThan(credit_already_issued.priority);
      }
    }
  });

  it("gates on the pre-dispute credit predicate, not merely on a refund", () => {
    expect(credit_already_issued.predicates.all).toContain("credit_preceded_dispute");
    expect(credit_already_issued.predicates.all).not.toContain("refund_processed");
  });
});

describe("credit_preceded_dispute predicate", () => {
  const evaluate = (facts: EvidenceFact[]) =>
    FACT_PREDICATES.credit_preceded_dispute.evaluate(facts);

  it("true only when the refund is processed AND preceded the dispute", () => {
    expect(
      evaluate([refundFact({ refundStatus: "processed", precededDispute: true })]),
    ).toBe(true);
  });

  it("false when the refund did not precede the dispute", () => {
    expect(
      evaluate([refundFact({ refundStatus: "processed", precededDispute: false })]),
    ).toBe(false);
  });

  it("false when the timing is simply absent — never assume", () => {
    expect(evaluate([refundFact({ refundStatus: "processed" })])).toBe(false);
    expect(evaluate([])).toBe(false);
  });
});

describe("credit_covers_disputed_amount predicate", () => {
  const evaluate = (facts: EvidenceFact[]) =>
    FACT_PREDICATES.credit_covers_disputed_amount.evaluate(facts);

  it("gates the 'in full' wording on full coverage", () => {
    expect(
      evaluate([
        refundFact({
          refundStatus: "processed",
          precededDispute: true,
          coversDisputedAmount: true,
        }),
      ]),
    ).toBe(true);
  });

  it("is false on a partial credit — 162042cd's $220 against $235", () => {
    expect(
      evaluate([
        refundFact({
          refundStatus: "processed",
          precededDispute: true,
          coversDisputedAmount: false,
          residual: 15,
        }),
      ]),
    ).toBe(false);
  });
});

describe("strategy prompt safety", () => {
  const body = credit_already_issued.promptBody;

  it("forbids asserting the dispute is invalid — that is the issuer's call", () => {
    expect(body).toMatch(/Do NOT declare the dispute 'invalid'/);
  });

  it("gates 'in full' on the coverage predicate", () => {
    expect(body).toMatch(/credit_covers_disputed_amount is true/);
  });

  it("forbids arguing the family's own theory alongside it", () => {
    expect(body).toMatch(/Do NOT argue the merits of the underlying claim/);
  });

  it("forbids speculating about why the refund was issued", () => {
    expect(body).toMatch(/Never speculate about WHY the refund was issued/);
  });
});

// Ordering is not suppression. On blume-box 162042cd the strategy led
// the bundle and unauthorized_fraud_auth_signal_stack, still present
// behind it, wrote a full paymentAuthenticationArgument anyway — on a
// case with avsResult='N' and a cardholder-name mismatch. Exclusivity
// has to be structural, not a line in a prompt.
describe("exclusivity", () => {
  const evalsFor = (
    truthy: string[],
  ): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    for (const id of Object.keys(FACT_PREDICATES)) out[id] = false;
    for (const id of truthy) out[id] = true;
    return out;
  };

  it("is declared exclusive", () => {
    expect(credit_already_issued.exclusive).toBe(true);
  });

  it("replaces the family's own strategies when it qualifies", () => {
    const bundle = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evalsFor([
        "credit_preceded_dispute",
        // Auth evidence that WOULD otherwise pull in the auth stack.
        "avs_and_cvv_match",
        "prior_customer",
      ]) as never,
      packageMode: "full" as never,
    });
    const keys = bundle.map((s) => s.key);
    expect(keys).toContain("credit_already_issued");
    expect(keys).not.toContain("unauthorized_fraud_auth_signal_stack");
    expect(keys).not.toContain("unauthorized_fraud_repeat_customer_pattern");
    // The fallback still rides along — tone rules, not a rival theory.
    expect(keys).toContain("unauthorized_fraud_narrow_fallback");
    expect(keys).toHaveLength(2);
  });

  it("leaves the normal bundle untouched when no credit precedes the dispute", () => {
    const bundle = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evalsFor(["avs_and_cvv_match", "prior_customer"]) as never,
      packageMode: "full" as never,
    });
    const keys = bundle.map((s) => s.key);
    expect(keys).not.toContain("credit_already_issued");
    expect(keys).toContain("unauthorized_fraud_auth_signal_stack");
  });

  it("a mere refund does not trigger exclusivity — only a PRE-dispute credit", () => {
    const bundle = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evalsFor(["refund_processed", "avs_and_cvv_match"]) as never,
      packageMode: "full" as never,
    });
    expect(bundle.map((s) => s.key)).not.toContain("credit_already_issued");
  });
});

// The output schema has a FIXED section list, so the model writes into
// paymentAuthenticationArgument even when the active strategy forbids
// arguing authorization. On 162042cd it did exactly that — softened to
// "supporting context only", but present, on a case with a failed AVS
// and a cardholder-name mismatch. Prompt text is a request; the
// suppression declaration is the enforcement.
describe("section suppression", () => {
  it("declares paymentAuthenticationArgument suppressed", () => {
    expect(credit_already_issued.suppressesSections).toContain(
      "paymentAuthenticationArgument",
    );
  });
});
