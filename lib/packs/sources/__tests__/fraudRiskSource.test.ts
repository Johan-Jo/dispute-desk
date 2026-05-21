/**
 * fraudRiskSource collector tests.
 *
 * Covers the eligibility matrix from
 * docs/plans/fraud-risk-incorporation.md § Phase 1 § Eligibility (strict):
 *
 *   - dispute.reason is fraud-family (FRAUDULENT / UNRECOGNIZED)  → continue
 *   - dispute.reason is NOT fraud-family (e.g. PRODUCT_NOT_RECEIVED) → []
 *   - risk_level NOT IN {LOW, NONE} → []
 *   - recommendation NOT IN {ACCEPT, NONE} → []
 *   - provider !== "shopify" → []
 *   - zero POSITIVE-sentiment facts → []
 *   - all positive: emits one section, capped at MAX_POSITIVE_FACTS_CITED
 *
 * Note (2026-05-19): risk_level=NONE is also eligible. Live Shopify
 * responses return NONE + ACCEPT + a populated facts array (Shopify
 * analysed the order, found no concerning signals). The original
 * gate treated NONE as "not analysed"; that proved wrong.
 *
 * The Supabase read is mocked; the collector's logic is the unit
 * under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import {
  collectFraudRiskEvidence,
  MAX_POSITIVE_FACTS_CITED,
} from "../fraudRiskSource";
import type { BuildContext } from "../../types";

const mockGetClient = vi.mocked(getServiceClient);

function buildSb(rows: unknown[] | null, error: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: rows, error }),
        }),
      }),
    })),
  };
}

const CTX_FRAUD: BuildContext = {
  packId: "p1",
  disputeId: "d1",
  shopId: "shop1",
  disputeReason: "FRAUDULENT",
  orderGid: "gid://shopify/Order/1001",
  shopDomain: "demo.myshopify.com",
  accessToken: "tok",
  order: null,
};

const CTX_NON_FRAUD: BuildContext = {
  ...CTX_FRAUD,
  disputeReason: "PRODUCT_NOT_RECEIVED",
};

const CTX_UNRECOGNIZED: BuildContext = {
  ...CTX_FRAUD,
  disputeReason: "UNRECOGNIZED",
};

const POSITIVE_ROW = {
  id: "r1",
  provider: "shopify",
  risk_level: "LOW",
  recommendation: "ACCEPT",
  facts_json: [
    { description: "Billing country matches IP country", sentiment: "POSITIVE" },
    { description: "Order placed during typical shopping hours", sentiment: "POSITIVE" },
    { description: "No previous chargebacks from this customer", sentiment: "NEUTRAL" },
    { description: "Card issuer in same country as billing", sentiment: "POSITIVE" },
    { description: "Distance from billing to shipping > 1000km", sentiment: "NEGATIVE" },
    { description: "Verified email domain", sentiment: "POSITIVE" },
  ],
  fact_sentiments: null,
  assessed_at: "2026-05-14T10:00:00Z",
  snapshot_at: "2026-05-14T10:00:01Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collectFraudRiskEvidence", () => {
  it("returns [] for non-fraud reasons (no DB read)", async () => {
    const sb = buildSb([POSITIVE_ROW]);
    mockGetClient.mockReturnValue(sb as never);

    const sections = await collectFraudRiskEvidence(CTX_NON_FRAUD);
    expect(sections).toEqual([]);
    // Did not even hit the DB.
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("returns [] when orderGid is missing", async () => {
    const sb = buildSb([POSITIVE_ROW]);
    mockGetClient.mockReturnValue(sb as never);

    const sections = await collectFraudRiskEvidence({
      ...CTX_FRAUD,
      orderGid: null,
    });
    expect(sections).toEqual([]);
  });

  it("returns [] on DB error (silent)", async () => {
    mockGetClient.mockReturnValue(
      buildSb(null, { message: "supabase down" }) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toEqual([]);
  });

  it("returns [] when no rows exist for this order", async () => {
    mockGetClient.mockReturnValue(buildSb([]) as never);
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toEqual([]);
  });

  it("returns [] when only third-party-provider rows exist", async () => {
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          provider: "Disputifier: Smart Chargebacks",
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toEqual([]);
  });

  it("emits an internal-only section when risk_level is HIGH (kept off bank submission, surfaced to merchant)", async () => {
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          risk_level: "HIGH",
          recommendation: "INVESTIGATE",
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
    const data = sections[0].data as {
      positiveFacts: string[];
      isNegativeVerdict?: boolean;
      riskLevel: string;
      recommendation: string;
    };
    expect(data.isNegativeVerdict).toBe(true);
    expect(data.positiveFacts).toEqual([]);
    expect(data.riskLevel).toBe("HIGH");
    expect(data.recommendation).toBe("INVESTIGATE");
  });

  it("emits an internal-only section when risk_level is MEDIUM", async () => {
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          risk_level: "MEDIUM",
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
    const data = sections[0].data as { isNegativeVerdict?: boolean; positiveFacts: string[] };
    expect(data.isNegativeVerdict).toBe(true);
    expect(data.positiveFacts).toEqual([]);
  });

  it("emits a section when risk_level=NONE + recommendation=ACCEPT + positive facts", async () => {
    // Locks in the 2026-05-19 gate widening. Live Shopify returns
    // NONE + ACCEPT with a populated facts array — that's a real
    // ACCEPT verdict, not a "not analysed" placeholder. The
    // recommendation field is the bank-facing signal.
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          risk_level: "NONE",
          recommendation: "ACCEPT",
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
    const data = sections[0].data as { riskLevel: string; recommendation: string };
    expect(data.riskLevel).toBe("NONE");
    expect(data.recommendation).toBe("ACCEPT");
  });

  it("emits a section when risk_level=NONE + recommendation=NONE + positive facts", async () => {
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          risk_level: "NONE",
          recommendation: "NONE",
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
  });

  it("emits an internal-only section when recommendation is REJECT (carries the verdict, not the facts)", async () => {
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          risk_level: "LOW",
          recommendation: "REJECT",
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
    const data = sections[0].data as {
      isNegativeVerdict?: boolean;
      positiveFacts: string[];
      recommendation: string;
    };
    expect(data.isNegativeVerdict).toBe(true);
    expect(data.positiveFacts).toEqual([]);
    expect(data.recommendation).toBe("REJECT");
  });

  it("emits an internal-only section when recommendation is CANCEL (2026-05-21 #1081 incident regression)", async () => {
    // The exact scenario from the live #1081 dispute: clean facts on paper
    // but Shopify recommended CANCEL because of cross-order risk history.
    // Pre-fix, the collector returned [] and the merchant saw nothing on
    // the Overview — looked like fraud screening never ran. Post-fix, the
    // row lands in "Kept internal" so the merchant knows we checked.
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          risk_level: "NONE",
          recommendation: "CANCEL",
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
    const data = sections[0].data as {
      isNegativeVerdict?: boolean;
      positiveFacts: string[];
      recommendation: string;
    };
    expect(data.isNegativeVerdict).toBe(true);
    expect(data.recommendation).toBe("CANCEL");
    // CRITICAL: positiveFacts is empty — the canonicalEvidence categorizer
    // returns "invalid" for empty positiveFacts, so the factClassifier
    // skips the row and it NEVER reaches the LLM payload or the bank
    // submission. The merchant sees it; the bank does not.
    expect(data.positiveFacts).toEqual([]);
  });

  it("emits an internal-only section when there are zero POSITIVE-sentiment facts", async () => {
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          facts_json: [
            { description: "Neutral fact A", sentiment: "NEUTRAL" },
            { description: "Negative fact B", sentiment: "NEGATIVE" },
          ],
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
    const data = sections[0].data as { isNegativeVerdict?: boolean; positiveFacts: string[] };
    expect(data.isNegativeVerdict).toBe(true);
    expect(data.positiveFacts).toEqual([]);
    // Original behavior preserved here too — we just stop returning [].
    expect(sections[0].fieldsProvided).toEqual(["fraud_risk_screening"]);
  });

  it("emits a section for FRAUDULENT with capped positive facts", async () => {
    mockGetClient.mockReturnValue(buildSb([POSITIVE_ROW]) as never);
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
    const s = sections[0];
    expect(s.fieldsProvided).toEqual(["fraud_risk_screening"]);
    expect(s.label).toBe("Pre-authorization fraud screening");
    const data = s.data as {
      provider: string;
      riskLevel: string;
      recommendation: string;
      positiveFacts: string[];
    };
    expect(data.provider).toBe("shopify");
    expect(data.riskLevel).toBe("LOW");
    expect(data.recommendation).toBe("ACCEPT");
    // Only POSITIVE facts, capped at MAX_POSITIVE_FACTS_CITED.
    expect(data.positiveFacts.length).toBeLessThanOrEqual(MAX_POSITIVE_FACTS_CITED);
    for (const fact of data.positiveFacts) {
      expect(typeof fact).toBe("string");
      expect(fact.length).toBeGreaterThan(0);
    }
    // Negative leakage guard at the data layer: NO neutral / negative
    // fact descriptions ever appear in the section payload.
    const allFactText = data.positiveFacts.join(" | ").toLowerCase();
    expect(allFactText).not.toContain("> 1000km");
    expect(allFactText).not.toContain("no previous chargebacks"); // NEUTRAL
  });

  it("supports the UNRECOGNIZED fraud-family reason code", async () => {
    mockGetClient.mockReturnValue(buildSb([POSITIVE_ROW]) as never);
    const sections = await collectFraudRiskEvidence(CTX_UNRECOGNIZED);
    expect(sections).toHaveLength(1);
  });

  it("accepts the parallel-array facts/sentiments shape", async () => {
    mockGetClient.mockReturnValue(
      buildSb([
        {
          ...POSITIVE_ROW,
          facts_json: [
            "Billing country matches IP country",
            "Order placed during typical shopping hours",
            "Distance > 1000km",
          ],
          fact_sentiments: ["POSITIVE", "POSITIVE", "NEGATIVE"],
        },
      ]) as never,
    );
    const sections = await collectFraudRiskEvidence(CTX_FRAUD);
    expect(sections).toHaveLength(1);
    const data = sections[0].data as { positiveFacts: string[] };
    expect(data.positiveFacts).toEqual([
      "Billing country matches IP country",
      "Order placed during typical shopping hours",
    ]);
  });
});
