import { describe, it, expect } from "vitest";
import {
  rankStrategies,
  strategyKeysFor,
  STRATEGIES_BY_FAMILY,
  ALL_STRATEGIES,
} from "../strategies/registry";
import type { FactPredicateId } from "../types";
import { ALL_REASON_CODE_FAMILIES } from "../reasonCodes/familyRegistry";

/** Build a predicateEvaluations map with the named ids set to true.
 *  All other ids default to false. */
function evals(...truthy: FactPredicateId[]): Record<FactPredicateId, boolean> {
  const set = new Set<FactPredicateId>(truthy);
  // Enumerate every predicate id we care about for ranking — we can
  // safely assume tests pass a complete map by deriving from evaluations
  // of an empty fact set in production, but the gateway here is just
  // the keys that matter for the gate.
  const ids: FactPredicateId[] = [
    "delivery_confirmed",
    "signature_captured",
    "digital_access_used",
    "digital_access_granted",
    "service_delivered",
    "service_completed_or_delivered",
    "customer_received_goods_or_service",
    "three_d_secure_present",
    "liability_shift_present",
    "avs_and_cvv_match",
    "avs_or_cvv_value_present",
    "billing_match_confirmed",
    "prior_customer",
    "policy_disclosed",
    "policy_accepted",
    "refund_processed",
    "subscription_terms_present",
    "customer_communication_on_record",
    "is_card_absent_dispute",
    "fulfilment_status_fulfilled",
    "fulfilment_status_unfulfilled",
    "safe_to_claim_fulfilment",
    "duplicate_distinct_markers",
    "order_record_present",
  ];
  const out = {} as Record<FactPredicateId, boolean>;
  for (const id of ids) out[id] = set.has(id);
  return out;
}

describe("rankStrategies (unauthorized_fraud pilot)", () => {
  it("with 3DS only → auth_signal_stack + narrow_fallback", () => {
    const ranked = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evals("three_d_secure_present", "is_card_absent_dispute"),
      packageMode: "full",
    });
    const keys = strategyKeysFor(ranked);
    expect(keys).toEqual([
      "unauthorized_fraud_auth_signal_stack",
      "unauthorized_fraud_narrow_fallback",
    ]);
  });

  it("with AVS+CVV match (no 3DS) → auth_signal_stack + narrow_fallback", () => {
    const ranked = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evals(
        "avs_and_cvv_match",
        "avs_or_cvv_value_present",
        "is_card_absent_dispute",
      ),
      packageMode: "full",
    });
    const keys = strategyKeysFor(ranked);
    expect(keys).toContain("unauthorized_fraud_auth_signal_stack");
    expect(keys).toContain("unauthorized_fraud_narrow_fallback");
  });

  it("with prior_customer + 3DS → 3 entries in canonical order", () => {
    const ranked = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evals(
        "three_d_secure_present",
        "prior_customer",
      ),
      packageMode: "full",
    });
    expect(strategyKeysFor(ranked)).toEqual([
      "unauthorized_fraud_auth_signal_stack",
      "unauthorized_fraud_repeat_customer_pattern",
      "unauthorized_fraud_narrow_fallback",
    ]);
  });

  it("with ALL predicates true → caps at max=3 (auth, repeat, fallback) — engagement drops", () => {
    const ranked = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evals(
        "three_d_secure_present",
        "avs_and_cvv_match",
        "prior_customer",
        "customer_communication_on_record",
      ),
      packageMode: "full",
    });
    // max=3 (default) reserves 1 slot for fallback, so we get at most
    // 2 non-fallback entries — in canonical order: auth_signal_stack +
    // repeat_customer_pattern, then narrow_fallback at the end.
    expect(strategyKeysFor(ranked)).toEqual([
      "unauthorized_fraud_auth_signal_stack",
      "unauthorized_fraud_repeat_customer_pattern",
      "unauthorized_fraud_narrow_fallback",
    ]);
  });

  it("with no predicates true → narrow_fallback only", () => {
    const ranked = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evals(),
      packageMode: "narrow",
    });
    expect(strategyKeysFor(ranked)).toEqual(["unauthorized_fraud_narrow_fallback"]);
  });

  it("max=2 trims non-fallback so total stays ≤ 2", () => {
    const ranked = rankStrategies({
      familyKey: "unauthorized_fraud",
      predicateEvaluations: evals(
        "three_d_secure_present",
        "prior_customer",
        "customer_communication_on_record",
      ),
      packageMode: "full",
      max: 2,
    });
    expect(strategyKeysFor(ranked)).toEqual([
      "unauthorized_fraud_auth_signal_stack",
      "unauthorized_fraud_narrow_fallback",
    ]);
  });
});

describe("rankStrategies (other families)", () => {
  it("every family returns at least its narrow_fallback when no other strategy qualifies", () => {
    for (const family of ALL_REASON_CODE_FAMILIES) {
      const ranked = rankStrategies({
        familyKey: family.key,
        predicateEvaluations: evals(),
        packageMode: "narrow",
      });
      // Phase 5 invariant: every family has ≥1 narrow_fallback strategy.
      expect(ranked.length).toBeGreaterThanOrEqual(1);
      expect(ranked.at(-1)?.isFallback).toBe(true);
    }
  });

  it("item_not_received with delivery_confirmed → delivery_proof_stack first", () => {
    const ranked = rankStrategies({
      familyKey: "item_not_received",
      predicateEvaluations: evals("delivery_confirmed"),
      packageMode: "full",
    });
    expect(ranked[0].key).toBe("item_not_received_delivery_proof_stack");
    expect(ranked.at(-1)?.isFallback).toBe(true);
  });

  it("credit_not_processed with refund_processed → refund_record first", () => {
    const ranked = rankStrategies({
      familyKey: "credit_not_processed",
      predicateEvaluations: evals("refund_processed"),
      packageMode: "full",
    });
    expect(ranked[0].key).toBe("credit_not_processed_refund_record");
  });

  it("duplicate_processing with both predicates → both strategies + fallback", () => {
    const ranked = rankStrategies({
      familyKey: "duplicate_processing",
      predicateEvaluations: evals("duplicate_distinct_markers", "refund_processed"),
      packageMode: "full",
    });
    const keys = ranked.map((s) => s.key);
    expect(keys).toContain("duplicate_processing_distinct_markers");
    expect(keys).toContain("duplicate_processing_refund_resolved");
    expect(keys.at(-1)).toBe("duplicate_processing_narrow_fallback");
  });
});

describe("strategy file invariants", () => {
  it("every strategy declares a known familyKey", () => {
    const validFamilies = new Set(
      ALL_REASON_CODE_FAMILIES.map((f) => f.key),
    );
    for (const s of ALL_STRATEGIES) {
      expect(validFamilies.has(s.familyKey)).toBe(true);
    }
  });

  it("strategies in STRATEGIES_BY_FAMILY[k] all declare familyKey=k", () => {
    for (const [familyKey, strategies] of Object.entries(STRATEGIES_BY_FAMILY)) {
      for (const s of strategies) {
        expect(s.familyKey).toBe(familyKey);
      }
    }
  });

  it("every non-fallback strategy declares ≥1 predicate gate (all/any/none)", () => {
    for (const s of ALL_STRATEGIES) {
      if (s.isFallback) continue;
      const total =
        (s.predicates.all?.length ?? 0) +
        (s.predicates.any?.length ?? 0) +
        (s.predicates.none?.length ?? 0);
      expect(total).toBeGreaterThan(0);
    }
  });

  it("strategy keys are unique across all families", () => {
    const keys = ALL_STRATEGIES.map((s) => s.key);
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it("unauthorized_fraud pilot has at least 4 strategies and exactly one fallback", () => {
    const family = STRATEGIES_BY_FAMILY.unauthorized_fraud;
    expect(family.length).toBeGreaterThanOrEqual(4);
    const fallbacks = family.filter((s) => s.isFallback);
    expect(fallbacks).toHaveLength(1);
  });

  it("no strategy promptBody contains its own family's prohibited bank-framing phrase (v2.2+)", () => {
    const familiesByKey = new Map(
      ALL_REASON_CODE_FAMILIES.map((f) => [f.key, f]),
    );
    for (const strategy of ALL_STRATEGIES) {
      const family = familiesByKey.get(strategy.familyKey);
      if (!family) continue;
      for (const pattern of family.prohibitedBankPhrases) {
        const match = strategy.promptBody.match(pattern)?.[0];
        expect(
          match,
          `${strategy.key} (family=${strategy.familyKey}) contains ${pattern}: "${match}"`,
        ).toBeUndefined();
      }
    }
  });
});
