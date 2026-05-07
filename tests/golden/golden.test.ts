/**
 * Golden dispute regression tests.
 *
 * For each registered fixture: feed the partial order + checklist +
 * payloads through the production engines and assert the observable
 * outputs match the expected shape. Pure-function — no I/O, no clocks,
 * no Shopify HTTP, no Supabase.
 *
 * See tests/golden/README.md for the full contract.
 */

import { describe, it, expect } from "vitest";
import {
  calculateCaseStrength,
  type CaseFatalLossInput,
} from "@/lib/argument/caseStrength";
import { detectFatalLoss } from "@/lib/automation/fatalLoss";
import { summarizeCoverage } from "@/lib/packs/sources/coverageSource";
import { buildEvidenceInputFromRaw } from "@/lib/shopify/fieldMapping";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

import { GOLDEN_FIXTURES, type GoldenFixture } from "./fixtures";

import { expected as strongDeliveredFraudExpected } from "./expected/strong-delivered-fraud.expected";
import { expected as digitalGoodsAccessExpected } from "./expected/digital-goods-access.expected";
import { expected as missingEvidenceExpected } from "./expected/missing-evidence.expected";
import { expected as refundBeforeChargebackExpected } from "./expected/refund-before-chargeback.expected";
import { expected as suspiciousRiskyOrderExpected } from "./expected/suspicious-risky-order.expected";
import { expected as duplicateChargeExpected } from "./expected/duplicate-charge.expected";
import { expected as productUnacceptableExpected } from "./expected/product-unacceptable.expected";
import { expected as subscriptionCanceledExpected } from "./expected/subscription-canceled.expected";

/* ── Public expected shape ── */

export interface GoldenExpected {
  coverage: { state: "covered_shopify" | "not_covered"; isCovered: boolean };
  fatalLoss: { triggered: boolean; reason: "refund_issued" | "inr_no_fulfillment" | null };
  strength: {
    overall: "strong" | "moderate" | "weak" | "insufficient";
    strongCount: number;
    moderateCount: number;
    supportingCount: number;
    heroVariant:
      | "likely_to_win"
      | "could_win"
      | "needs_strengthening"
      | "hard_to_win"
      | "covered";
  };
  /** Sorted list of `DisputeEvidenceUpdateInput` keys that came back
   *  populated. Text bodies are intentionally NOT snapshotted. */
  shopifyFieldsPopulated: string[];
}

const EXPECTED: Record<string, GoldenExpected> = {
  "strong-delivered-fraud": strongDeliveredFraudExpected,
  "digital-goods-access": digitalGoodsAccessExpected,
  "missing-evidence": missingEvidenceExpected,
  "refund-before-chargeback": refundBeforeChargebackExpected,
  "suspicious-risky-order": suspiciousRiskyOrderExpected,
  "duplicate-charge": duplicateChargeExpected,
  "product-unacceptable": productUnacceptableExpected,
  "subscription-canceled": subscriptionCanceledExpected,
};

function runFixture(fixture: GoldenFixture): GoldenExpected {
  const order = (fixture.order ?? null) as OrderDetailNode | null;

  const coverage = summarizeCoverage(order);
  const fatal = detectFatalLoss(order, fixture.disputeReason, fixture.disputeAmount);
  const fatalLossInput: CaseFatalLossInput = {
    triggered: fatal.triggered,
    reason: fatal.reason,
    message: fatal.message,
  };

  const strength = calculateCaseStrength(
    null,
    fixture.checklist,
    fixture.disputeReason,
    {
      kind: "byField",
      map: Object.fromEntries(
        Object.entries(fixture.evidencePayloads).map(([k, v]) => [k, v ? { payload: v } : null]),
      ),
    },
    coverage.shopifyProtectStatus
      ? { state: coverage.state, shopifyProtectStatus: coverage.shopifyProtectStatus }
      : undefined,
    fatalLossInput,
  );

  const shopifyInput = buildEvidenceInputFromRaw(fixture.packSections);
  const shopifyFieldsPopulated = Object.keys(shopifyInput).sort();

  return {
    coverage: { state: coverage.state, isCovered: coverage.isCovered },
    fatalLoss: { triggered: fatal.triggered, reason: fatal.reason },
    strength: {
      overall: strength.overall,
      strongCount: strength.strongCount,
      moderateCount: strength.moderateCount,
      supportingCount: strength.supportingCount,
      heroVariant: strength.heroVariant ?? "hard_to_win",
    },
    shopifyFieldsPopulated,
  };
}

describe("golden dispute fixtures", () => {
  it("registry has at least one fixture and every fixture has an expected", () => {
    expect(GOLDEN_FIXTURES.length).toBeGreaterThan(0);
    for (const f of GOLDEN_FIXTURES) {
      expect(EXPECTED[f.name], `missing expected for fixture "${f.name}"`).toBeDefined();
    }
  });

  for (const fixture of GOLDEN_FIXTURES) {
    it(`${fixture.name} — ${fixture.description}`, () => {
      const actual = runFixture(fixture);
      const want = EXPECTED[fixture.name];
      // Sort the expected list too so test author ordering doesn't matter.
      const wantSorted: GoldenExpected = {
        ...want,
        shopifyFieldsPopulated: [...want.shopifyFieldsPopulated].sort(),
      };
      expect(actual).toEqual(wantSorted);
    });
  }
});
