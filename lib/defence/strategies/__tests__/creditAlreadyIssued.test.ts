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
import { STRATEGIES_BY_FAMILY } from "../registry";
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
