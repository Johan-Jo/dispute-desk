/**
 * Policy Simulator (design §16). Given a policy segment + assumptions, reports
 * the historical exposure and an avoided-loss RANGE under conservative /
 * expected / optimistic effectiveness scenarios. NEVER assumes all historical
 * disputes in the segment would have been prevented — effectiveness is an
 * explicit assumption (integer basis points, no float). All simulated figures
 * are labeled estimates.
 */

import { runSegmentSimulation, type SegmentFilters, type SegmentFacts } from "../db/tenantScope";
import { moneyFromDecimal, scaleByBasisPoints, subMoney, zeroMoney, toDecimalString, type Money } from "../money";
import { scoreConfidence } from "../stats/confidence";
import type { Confidence, EvidenceGrade } from "../types";

export interface EffectivenessScenario {
  conservativeBps: number;
  expectedBps: number;
  optimisticBps: number;
}

export interface PolicyCosts {
  /** Per-affected-order implementation cost (review/signature), minor units. */
  perOrderCostMinor: number;
  safetyMarginBps?: number; // shave avoided loss by this before netting
}

export interface SimulationInput {
  template: string;
  currency: string;
  filters: SegmentFilters;
  effectiveness: EffectivenessScenario;
  costs: PolicyCosts;
}

export interface ScenarioBand {
  conservative: string;
  expected: string;
  optimistic: string;
}

export interface SimulationResult {
  template: string;
  currency: string;
  ordersAffected: number;
  disputesInSegment: number;
  revenueAffected: string;
  disputedValueInSegment: string;
  netLossInSegment: string;
  legitimateOrdersAffected: number;
  reviewWorkload: number;
  implementationCost: string;
  avoidedLoss: ScenarioBand; // after safety margin
  netImpact: ScenarioBand; // avoidedLoss - implementationCost
  confidence: Confidence;
  evidenceGrade: EvidenceGrade;
  assumptions: string[];
  limitations: string[];
}

export async function simulatePolicy(
  shopId: string,
  input: SimulationInput,
): Promise<SimulationResult> {
  const facts = await runSegmentSimulation(shopId, input.filters);
  return buildSimulation(facts, input);
}

/** Pure — deterministic given the segment facts + input. */
export function buildSimulation(facts: SegmentFacts, input: SimulationInput): SimulationResult {
  const cur = input.currency;
  const netLoss = moneyFromDecimal(facts.net_loss_in_segment, cur) ?? zeroMoney(cur);
  const implCost: Money = { amountMinor: BigInt(input.costs.perOrderCostMinor) * BigInt(facts.orders_affected), currency: cur };
  const safety = input.costs.safetyMarginBps ?? 0;

  const avoided = (bps: number): Money => {
    let a = scaleByBasisPoints(netLoss, bps);
    if (safety > 0) a = scaleByBasisPoints(a, 10000 - safety); // shave by safety margin
    return a;
  };
  const con = avoided(input.effectiveness.conservativeBps);
  const exp = avoided(input.effectiveness.expectedBps);
  const opt = avoided(input.effectiveness.optimisticBps);

  const confidence = scoreConfidence("recommendation", {
    events: facts.disputes_in_segment,
    ciWidth: 0.3,
    missingnessPct: 0,
    temporalStability: "sign_consistent",
    classification: input.filters.riskLevels ? "inferred" : "direct_derived", // risk is retrospective
    measurementValidity: input.filters.riskLevels ? "proxy_gap" : "valid",
    fdr: "q10",
    confounders: "principal_unmeasured",
  }).confidence;

  const limitations = [
    "Historical segment exposure — NOT a guarantee. Effectiveness is an assumption, shown as a range.",
    "Assumes only a fraction of segment disputes would be prevented; never 100%.",
    `${facts.legit_orders_affected} legitimate (non-disputed) orders fall in this segment — customer-friction exposure.`,
  ];
  if (input.filters.riskLevels) {
    limitations.push("Risk-level filter uses retrospective risk (leakage) — treat as illustrative, not prospectively valid (§14.1).");
  }

  return {
    template: input.template,
    currency: cur,
    ordersAffected: facts.orders_affected,
    disputesInSegment: facts.disputes_in_segment,
    revenueAffected: toMajor(facts.revenue_affected),
    disputedValueInSegment: toMajor(facts.disputed_value),
    netLossInSegment: toDecimalString(netLoss),
    legitimateOrdersAffected: facts.legit_orders_affected,
    reviewWorkload: facts.orders_affected,
    implementationCost: toDecimalString(implCost),
    avoidedLoss: { conservative: toDecimalString(con), expected: toDecimalString(exp), optimistic: toDecimalString(opt) },
    netImpact: {
      conservative: toDecimalString(subMoney(con, implCost)),
      expected: toDecimalString(subMoney(exp, implCost)),
      optimistic: toDecimalString(subMoney(opt, implCost)),
    },
    confidence,
    evidenceGrade: "descriptive",
    assumptions: [
      `Effectiveness scenarios: ${input.effectiveness.conservativeBps / 100}% / ${input.effectiveness.expectedBps / 100}% / ${input.effectiveness.optimisticBps / 100}% of segment net loss avoided.`,
      `Implementation cost ${cur} ${(input.costs.perOrderCostMinor / 100).toFixed(2)} per affected order.`,
      safety > 0 ? `Safety margin ${safety / 100}% applied to avoided loss.` : "No safety margin applied.",
    ],
    limitations,
  };
}

/** revenue/disputed come from the RPC as numeric strings (major units). */
function toMajor(numericStr: string): string {
  return numericStr;
}
