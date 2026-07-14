/**
 * Regression: the dashboard's "Waiting on Issuer" card must count every
 * normalized_status the disputes list renders as "Submitted"
 * (under-review family), or a dispute can show a Submitted chip in the
 * list while appearing on none of the four operational cards.
 *
 * Seen live 2026-07-14 on cay-collective #12121: normalized_status
 * "submitted" (Shopify evidenceSentOn confirmed, raw status still
 * needs_response) → list said "Submitted", Waiting on Issuer said 0.
 * The card previously summed only waiting_on_issuer + submitted_to_bank.
 */
import { describe, it, expect } from "vitest";
import {
  UNDER_REVIEW_NORMALIZED_STATUSES,
  figmaStatus,
  type Dispute,
} from "@/app/(embedded)/app/disputes/disputeListHelpers";

function dispute(normalized_status: string): Dispute {
  return {
    id: "d1",
    dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1",
    order_gid: null,
    status: "needs_response",
    reason: "CREDIT_NOT_PROCESSED",
    phase: "chargeback",
    amount: 549,
    currency_code: "SEK",
    due_at: null,
    initiated_at: null,
    needs_review: false,
    last_synced_at: null,
    normalized_status,
  } as Dispute;
}

describe("Waiting on Issuer bucket ↔ list under-review family", () => {
  it("the shared family covers exactly the statuses figmaStatus collapses to under-review", () => {
    for (const ns of UNDER_REVIEW_NORMALIZED_STATUSES) {
      expect(figmaStatus(dispute(ns)), ns).toBe("under-review");
    }
  });

  it("'submitted' is in the family (the 2026-07-14 gap)", () => {
    expect(UNDER_REVIEW_NORMALIZED_STATUSES).toContain("submitted");
  });

  it("'submitted_to_shopify' is in the family", () => {
    expect(UNDER_REVIEW_NORMALIZED_STATUSES).toContain("submitted_to_shopify");
  });

  it("statuses outside the family do not collapse to under-review", () => {
    for (const ns of ["new", "needs_review", "ready_to_submit", "in_progress", "action_needed"]) {
      expect(figmaStatus(dispute(ns)), ns).not.toBe("under-review");
    }
  });
});
