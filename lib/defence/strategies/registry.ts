/**
 * Strategy registry. Layer 3 — below families and modules.
 *
 * Each family declares an ordered list of `StrategySubmodule`s.
 * `rankStrategies` filters by predicate gates over the current
 * `predicateEvaluations`, sorts by family-canonical order (the order
 * strategies appear in `STRATEGIES_BY_FAMILY[familyKey]`) with
 * `priority` as a tiebreaker, and caps the bundle at `max` entries.
 * The family's `isFallback` strategy is ALWAYS appended at the end
 * when one exists — so the strategy bundle is never empty even when
 * no specific strategy qualifies.
 *
 * Bundle ordering rationale: family-canonical order maximises prompt-
 * cache reuse across disputes selecting the same strategy set. Two
 * strategies in the same position resolve by priority (higher wins);
 * ties resolve by declaration order.
 *
 * Phase 3 (this file): pilot family `unauthorized_fraud` only.
 * Phase 5: remaining 8 families.
 */

import type {
  FactPredicateId,
  PackageMode,
  ReasonCodeFamilyKey,
  StrategySubmodule,
} from "../types";

import { unauthorized_fraud_auth_signal_stack } from "./unauthorized_fraud_auth_signal_stack";
import { unauthorized_fraud_repeat_customer_pattern } from "./unauthorized_fraud_repeat_customer_pattern";
import { unauthorized_fraud_customer_engagement_history } from "./unauthorized_fraud_customer_engagement_history";
import { unauthorized_fraud_narrow_fallback } from "./unauthorized_fraud_narrow_fallback";

import { item_not_received_delivery_proof_stack } from "./item_not_received_delivery_proof_stack";
import { item_not_received_digital_access_record } from "./item_not_received_digital_access_record";
import { item_not_received_narrow_fallback } from "./item_not_received_narrow_fallback";

import { product_not_as_described_listing_as_purchased } from "./product_not_as_described_listing_as_purchased";
import { product_not_as_described_resolution_attempt } from "./product_not_as_described_resolution_attempt";
import { product_not_as_described_narrow_fallback } from "./product_not_as_described_narrow_fallback";

import { credit_not_processed_refund_record } from "./credit_not_processed_refund_record";
import { credit_not_processed_policy_terms } from "./credit_not_processed_policy_terms";
import { credit_not_processed_narrow_fallback } from "./credit_not_processed_narrow_fallback";

import { duplicate_processing_distinct_markers } from "./duplicate_processing_distinct_markers";
import { duplicate_processing_refund_resolved } from "./duplicate_processing_refund_resolved";
import { duplicate_processing_narrow_fallback } from "./duplicate_processing_narrow_fallback";

import { cancelled_recurring_subscription_terms } from "./cancelled_recurring_subscription_terms";
import { cancelled_recurring_service_usage } from "./cancelled_recurring_service_usage";
import { cancelled_recurring_narrow_fallback } from "./cancelled_recurring_narrow_fallback";

import { processing_error_narrow_fallback } from "./processing_error_narrow_fallback";
import { authorization_error_narrow_fallback } from "./authorization_error_narrow_fallback";
import { fallback_narrow_fallback } from "./fallback_narrow_fallback";

/** Family-canonical order — declaration order IS the canonical order.
 *  Reorder with care; the prompt-cache prefix changes when this order
 *  changes. Empty arrays are valid (family has no strategies yet). */
export const STRATEGIES_BY_FAMILY: Record<ReasonCodeFamilyKey, StrategySubmodule[]> = {
  unauthorized_fraud: [
    unauthorized_fraud_auth_signal_stack,
    unauthorized_fraud_repeat_customer_pattern,
    unauthorized_fraud_customer_engagement_history,
    unauthorized_fraud_narrow_fallback,
  ],
  item_not_received: [
    item_not_received_delivery_proof_stack,
    item_not_received_digital_access_record,
    item_not_received_narrow_fallback,
  ],
  product_not_as_described: [
    product_not_as_described_listing_as_purchased,
    product_not_as_described_resolution_attempt,
    product_not_as_described_narrow_fallback,
  ],
  credit_not_processed: [
    credit_not_processed_refund_record,
    credit_not_processed_policy_terms,
    credit_not_processed_narrow_fallback,
  ],
  duplicate_processing: [
    duplicate_processing_distinct_markers,
    duplicate_processing_refund_resolved,
    duplicate_processing_narrow_fallback,
  ],
  cancelled_recurring: [
    cancelled_recurring_subscription_terms,
    cancelled_recurring_service_usage,
    cancelled_recurring_narrow_fallback,
  ],
  processing_error: [processing_error_narrow_fallback],
  authorization_error: [authorization_error_narrow_fallback],
  fallback: [fallback_narrow_fallback],
};

export interface RankStrategiesInput {
  familyKey: ReasonCodeFamilyKey;
  predicateEvaluations: Record<FactPredicateId, boolean>;
  packageMode: PackageMode;
  /** Cap at this many entries. Default 3. The family's fallback always
   *  counts toward the cap when included. */
  max?: number;
}

/** Predicate-gate evaluator. A strategy is eligible when:
 *    - every id in `predicates.all` evaluates true   (default ALL: empty = pass)
 *    - at least one id in `predicates.any` is true   (default ANY: empty = pass)
 *    - every id in `predicates.none` evaluates false (default NONE: empty = pass)
 *  isFallback strategies bypass the gate entirely. */
function gatePass(
  strategy: StrategySubmodule,
  evaluations: Record<FactPredicateId, boolean>,
): boolean {
  if (strategy.isFallback) return true;
  const { all, any, none } = strategy.predicates;
  if (all && all.length > 0 && !all.every((id) => evaluations[id] === true)) return false;
  if (any && any.length > 0 && !any.some((id) => evaluations[id] === true)) return false;
  if (none && none.length > 0 && !none.every((id) => evaluations[id] === false)) return false;
  return true;
}

/** Rank strategies for a family. Returns 1–`max` entries in family-
 *  canonical order, with the family's isFallback strategy always last
 *  if one exists. Empty family → empty result. */
export function rankStrategies(input: RankStrategiesInput): StrategySubmodule[] {
  const max = input.max ?? 3;
  const all = STRATEGIES_BY_FAMILY[input.familyKey] ?? [];
  if (all.length === 0) return [];

  // Stable canonical index per strategy.
  const indexed = all.map((s, i) => ({ s, idx: i }));

  // Eligible non-fallback strategies first, then we explicitly append
  // the fallback.
  const eligibleNonFallback = indexed.filter(
    ({ s }) => !s.isFallback && gatePass(s, input.predicateEvaluations),
  );

  // Sort by canonical position (idx ascending); priority breaks ties
  // (higher priority wins).
  eligibleNonFallback.sort((a, b) => {
    if (a.idx !== b.idx) return a.idx - b.idx;
    return b.s.priority - a.s.priority;
  });

  const fallback = indexed.find(({ s }) => s.isFallback)?.s ?? null;

  // Cap non-fallback to (max - 1) if a fallback exists, since the
  // fallback always appears as the last entry. If no fallback, cap to
  // max.
  const reservedForFallback = fallback ? 1 : 0;
  const head = eligibleNonFallback
    .slice(0, Math.max(0, max - reservedForFallback))
    .map((e) => e.s);

  return fallback ? [...head, fallback] : head;
}

/** Convenience: extract strategy keys from a rank result. Useful for
 *  telemetry rows (defence_package_runs.strategy_keys). */
export function strategyKeysFor(strategies: StrategySubmodule[]): string[] {
  return strategies.map((s) => s.key);
}

/** All strategies declared across all families. Used by tests and
 *  drift guards. */
export const ALL_STRATEGIES: StrategySubmodule[] = Object.values(
  STRATEGIES_BY_FAMILY,
).flat();
