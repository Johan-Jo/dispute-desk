/**
 * Pins the attribution arithmetic that `getShopRiskProfile` performs over its
 * dispute rows. The profile function itself is DB-coupled, so this reproduces
 * its aggregation loop against the real resolver rather than mocking Supabase.
 *
 * The scenario is the prod one that motivated the split (measured 2026-09-21):
 * a shop whose disputes are overwhelmingly filed by Shopify's own auto-file,
 * where the unattributed win rate describes the platform, not this product.
 */
import { describe, it, expect } from "vitest";
import { isDisputeDeskFiled, resolveFiledBy, type FiledByInput } from "../filedBy";

interface Row extends FiledByInput {
  final_outcome: string | null;
}

function aggregate(rows: Row[]) {
  const outcomeBreakdown = { won: 0, lost: 0, pending: 0 };
  const attributedOutcome = { won: 0, lost: 0 };
  const filedByBreakdown = { disputedesk: 0, shopify: 0, unknown: 0 };

  for (const d of rows) {
    const outcome = String(d.final_outcome ?? "");
    const outcomeKey =
      outcome === "won" ? "won" : outcome === "lost" ? "lost" : "pending";
    outcomeBreakdown[outcomeKey] += 1;
    filedByBreakdown[resolveFiledBy(d)] += 1;
    if (isDisputeDeskFiled(d) && outcomeKey !== "pending") {
      attributedOutcome[outcomeKey] += 1;
    }
  }

  const denom = outcomeBreakdown.won + outcomeBreakdown.lost;
  const winRate = denom > 0 ? Math.round((outcomeBreakdown.won / denom) * 100) : 0;
  const attributedDenom = attributedOutcome.won + attributedOutcome.lost;
  const winRateAttributed = {
    ...attributedOutcome,
    rate:
      attributedDenom > 0
        ? Math.round((attributedOutcome.won / attributedDenom) * 100)
        : null,
  };
  return { outcomeBreakdown, winRate, winRateAttributed, filedByBreakdown };
}

const shopifyWon: Row = {
  final_outcome: "won",
  submission_state: "submitted_confirmed",
  evidence_saved_to_shopify_at: null,
};
const ddWon: Row = {
  final_outcome: "won",
  submission_state: "submitted_confirmed",
  evidence_saved_to_shopify_at: "2026-08-15T21:30:31Z",
};
const ddLost: Row = {
  final_outcome: "lost",
  submission_state: "submitted_confirmed",
  evidence_saved_to_shopify_at: "2026-08-15T21:30:31Z",
};

describe("shopRisk attribution split", () => {
  it("reports no attributed rate when DisputeDesk filed nothing", () => {
    // The 6a8848-dd shape: many platform wins, zero DisputeDesk saves. The
    // unattributed rate stays high and truthful about the shop's experience;
    // the attributed one must be null, NOT 0 — 0% would read as "we lost
    // every case" when we handled none.
    const result = aggregate([shopifyWon, shopifyWon, shopifyWon]);

    expect(result.winRate).toBe(100);
    expect(result.winRateAttributed.rate).toBeNull();
    expect(result.winRateAttributed.won).toBe(0);
    expect(result.filedByBreakdown).toEqual({
      disputedesk: 0,
      shopify: 3,
      unknown: 0,
    });
  });

  it("diverges from the unattributed rate on a mixed shop", () => {
    // 3 platform wins + 1 DD win + 1 DD loss. Overall reads 80%; the product
    // actually went 1-for-2.
    const result = aggregate([shopifyWon, shopifyWon, shopifyWon, ddWon, ddLost]);

    expect(result.winRate).toBe(80);
    expect(result.winRateAttributed).toEqual({ won: 1, lost: 1, rate: 50 });
    expect(result.filedByBreakdown.disputedesk).toBe(2);
    expect(result.filedByBreakdown.shopify).toBe(3);
  });

  it("excludes undecided disputes from the attributed denominator", () => {
    const pendingDd: Row = {
      final_outcome: null,
      submission_state: "saved_to_shopify",
      evidence_saved_to_shopify_at: "2026-09-01T10:00:00Z",
    };
    const result = aggregate([ddWon, pendingDd]);

    expect(result.winRateAttributed).toEqual({ won: 1, lost: 0, rate: 100 });
    expect(result.outcomeBreakdown.pending).toBe(1);
    expect(result.filedByBreakdown.disputedesk).toBe(2);
  });

  it("counts a dispute with no submission signal as unknown", () => {
    const orphan: Row = {
      final_outcome: "lost",
      submission_state: "not_saved",
      evidence_saved_to_shopify_at: null,
    };
    const result = aggregate([orphan]);

    expect(result.filedByBreakdown.unknown).toBe(1);
    expect(result.winRateAttributed.rate).toBeNull();
    expect(result.winRate).toBe(0);
  });
});
