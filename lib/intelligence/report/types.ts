/**
 * Baseline descriptive report types (design §9, §7.1). Every rate carries its
 * numerator/denominator and interval; monetary figures are bigint minor units.
 * Binary rates use Wilson; monetary quantities use bootstrap — never mixed.
 */

import type { Confidence } from "../types";

export interface RateMetric {
  name: string;
  numerator: number;
  denominator: number;
  point: number;
  lower: number;
  upper: number;
  method: "wilson";
  confidence: Confidence;
  excluded?: { reason: string; count: number }[];
}

export interface MoneyMetric {
  name: string;
  amountMinor: string; // decimal-string bigint at the boundary
  currency: string;
}

export interface BootstrapMetric {
  name: string;
  point: number;
  lower: number;
  upper: number;
  method: "bootstrap";
  sampleSize: number;
  confidence: Confidence;
}

export interface BaselineReport {
  currency: string;
  otherCurrencyDisputeCount: number; // disputes in non-dominant currencies (never summed in)
  period: { from: string | null; to: string | null };

  portfolio: {
    totalDisputes: number;
    totalDisputedAmount: MoneyMetric;
    totalRecovered: MoneyMetric;
    totalNetLoss: MoneyMetric;
    adjudicatedCount: number;
    respondedCount: number;
    disputesWithAmount: number;
    disputesByYear: Record<string, number>;
  };

  rates: {
    fullWinRate: RateMetric;
    anyRecoveryRate: RateMetric;
    rawResponseRate: RateMetric;
    actionableResponseRate: RateMetric;
  };

  monetary: {
    monetaryRecoveryRate: BootstrapMetric; // Σrecovered / Σdisputed
    avgRecoveryPerResponse: BootstrapMetric;
  };

  limitations: string[];
}
