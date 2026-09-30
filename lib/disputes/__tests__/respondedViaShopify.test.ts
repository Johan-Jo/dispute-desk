/**
 * Fix A (docs/plans/mein-maison-status-and-no-return.plan.md): a response
 * observed through Shopify. Pins the three readings of `under_review`, the
 * normalization branch, the lifecycle truth table, the same-deadline re-ask
 * (not a reopen) and what applyDisputeSnapshot writes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({
  emitDisputeEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn(async () => {}),
}));
vi.mock("@/lib/disputes/responseCycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/disputes/responseCycle")>();
  return { ...actual, reconcileResponseCycle: vi.fn() };
});

import { applyDisputeSnapshot } from "@/lib/disputes/applyDisputeSnapshot";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { deriveNormalizedStatus } from "@/lib/disputeEvents/normalizeStatus";
import { opensNewResponseCycle, reconcileResponseCycle } from "@/lib/disputes/responseCycle";
import { isTransmissionConfirmed, resolveLifecycle } from "@/lib/disputes/presentation/resolveLifecycle";
import {
  isAwaitingShopifyDeadline,
  isSameCycleAskAgain,
  isUnattributedUnderReview,
  observesResponseViaShopify,
} from "@/lib/disputes/respondedViaShopify";
import type { DisputeSnapshot } from "@/lib/disputes/disputeSnapshot";

const mockEmit = vi.mocked(emitDisputeEvent);
const mockReconcile = vi.mocked(reconcileResponseCycle);
const DEADLINE = "2026-10-05T23:59:59Z";

describe("the three readings of under_review", () => {
  it("no deadline = Shopify's creation state, nothing answered", () => {
    expect(isAwaitingShopifyDeadline({ status: "under_review", dueAt: null })).toBe(true);
    expect(isAwaitingShopifyDeadline({ status: "under_review", dueAt: "1970-01-01T00:00:00Z" })).toBe(true);
    expect(isAwaitingShopifyDeadline({ status: "under_review", dueAt: DEADLINE })).toBe(false);
    expect(isAwaitingShopifyDeadline({ status: "needs_response", dueAt: null })).toBe(false);
  });

  it("needs_response -> under_review with a deadline and nothing sent = responded via Shopify", () => {
    const base = {
      oldStatus: "needs_response",
      newStatus: "under_review",
      newDueAt: DEADLINE,
      submissionState: "not_saved",
      closed: false,
    };
    expect(observesResponseViaShopify(base)).toBe(true);
    expect(observesResponseViaShopify({ ...base, submissionState: null })).toBe(true);
    // our own save/submission is not a Shopify-observed response
    expect(observesResponseViaShopify({ ...base, submissionState: "saved_to_shopify" })).toBe(false);
    expect(observesResponseViaShopify({ ...base, submissionState: "submitted_confirmed" })).toBe(false);
    // the creation hop (no deadline) is not a response
    expect(observesResponseViaShopify({ ...base, newDueAt: null })).toBe(false);
    expect(observesResponseViaShopify({ ...base, oldStatus: "under_review" })).toBe(false);
    expect(observesResponseViaShopify({ ...base, closed: true })).toBe(false);
  });

  it("first seen under_review with a deadline and no submission = unattributed", () => {
    expect(isUnattributedUnderReview({ status: "under_review", dueAt: DEADLINE, evidenceSentOn: null })).toBe(true);
    expect(isUnattributedUnderReview({ status: "under_review", dueAt: null, evidenceSentOn: null })).toBe(false);
    expect(
      isUnattributedUnderReview({ status: "under_review", dueAt: DEADLINE, evidenceSentOn: "2026-09-01T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("normalization (A1/A3)", () => {
  it("under_review with no deadline is new, not submitted_to_bank", () => {
    expect(deriveNormalizedStatus("under_review", null, "not_saved", false, null).normalizedStatus).toBe("new");
  });
  it("legacy callers that don't pass a deadline keep the old mapping", () => {
    expect(deriveNormalizedStatus("under_review", null, "not_saved", false).normalizedStatus).toBe(
      "submitted_to_bank",
    );
  });
  it("observed responses map to submitted_to_bank with their own reason", () => {
    const via = deriveNormalizedStatus("under_review", null, "responded_via_shopify", false, DEADLINE);
    expect(via.normalizedStatus).toBe("submitted_to_bank");
    expect(via.statusReason).toBe("A response was sent through Shopify");
    const un = deriveNormalizedStatus("under_review", null, "under_review_unattributed", false, DEADLINE);
    expect(un.normalizedStatus).toBe("submitted_to_bank");
    expect(un.statusReason).toBe("Under review in Shopify");
  });
});

describe("lifecycle truth table (A3)", () => {
  const base = { finalOutcome: null, closedAt: null, packStatus: null };
  it.each([
    ["responded_via_shopify", "submitted_to_bank", true],
    ["under_review_unattributed", "submitted_to_bank", true],
    // re-asked in the same cycle: the state is reset, but even a stale value
    // must not claim transmission while Shopify says needs_response
    ["responded_via_shopify", "new", false],
    ["not_saved", "submitted_to_bank", false],
    ["submitted_confirmed", "new", true],
  ])("%s + %s -> %s", (submissionState, normalizedStatus, expected) => {
    expect(isTransmissionConfirmed({ submissionState, normalizedStatus })).toBe(expected);
  });

  it("an answered-in-Shopify dispute resolves to under_review, not building_evidence", () => {
    expect(
      resolveLifecycle({ ...base, submissionState: "responded_via_shopify", normalizedStatus: "submitted_to_bank" }),
    ).toBe("under_review");
    expect(
      resolveLifecycle({ ...base, submissionState: "not_saved", normalizedStatus: "submitted_to_bank" }),
    ).toBe("building_evidence");
  });
});

describe("re-asked with the same deadline is not a reopen (#99143)", () => {
  const observed = {
    status: "under_review",
    due_at: DEADLINE,
    submitted_at: null,
    submission_state: "responded_via_shopify",
  };
  it("same deadline: no new cycle, but a same-cycle re-ask", () => {
    expect(opensNewResponseCycle({ existing: observed, newStatus: "needs_response", newDueAt: DEADLINE })).toBe(false);
    expect(
      isSameCycleAskAgain({
        submissionState: "responded_via_shopify",
        oldDueAt: DEADLINE,
        newStatus: "needs_response",
        newDueAt: DEADLINE,
      }),
    ).toBe(true);
  });
  it("a new deadline after an observed response IS a reopen", () => {
    expect(
      opensNewResponseCycle({ existing: observed, newStatus: "needs_response", newDueAt: "2026-10-20T23:59:59Z" }),
    ).toBe(true);
  });
  it("a recorded save still reopens on the same deadline (Fix B unchanged)", () => {
    expect(
      opensNewResponseCycle({
        existing: { ...observed, submission_state: "submitted_confirmed", submitted_at: "2026-09-20T00:00:00Z" },
        newStatus: "needs_response",
        newDueAt: DEADLINE,
      }),
    ).toBe(true);
  });
});

// ── applyDisputeSnapshot ────────────────────────────────────────────────

interface Existing {
  id: string;
  status: string | null;
  due_at: string | null;
  submitted_at: string | null;
  final_outcome: string | null;
  submission_state: string | null;
  new_dispute_alert_sent_at: string | null;
  shopify_updated_at: string | null;
  dispute_evidence_gid: string | null;
  phase?: string | null;
  response_cycle?: number | null;
}

function setupClient(existing: Existing | null, insertedId = "d-new") {
  const updateCalls: Record<string, unknown>[] = [];
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.eq = vi.fn(() => c);
    c.is = vi.fn(() => c);
    c.in = vi.fn(() => c);
    c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
    return c;
  };
  const from = (table: string): any => {
    if (table !== "disputes") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
          })),
        })),
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: existing?.id ?? insertedId }, error: null }),
        })),
      })),
      update: vi.fn((row: Record<string, unknown>) => {
        updateCalls.push(row);
        return chain();
      }),
    };
  };
  return { client: { from } as unknown as never, updateCalls };
}

const OPEN_INQUIRY: Existing = {
  id: "d-100300",
  status: "needs_response",
  due_at: DEADLINE,
  submitted_at: null,
  final_outcome: null,
  submission_state: "not_saved",
  new_dispute_alert_sent_at: "2026-09-01T00:00:00Z",
  shopify_updated_at: "2026-09-01T00:00:00Z",
  dispute_evidence_gid: "gid://shopify/ShopifyPaymentsDisputeEvidence/1",
  phase: "inquiry",
  response_cycle: 1,
};

function snap(over: Partial<DisputeSnapshot>): DisputeSnapshot {
  return {
    disputeGid: "gid://shopify/ShopifyPaymentsDispute/100300",
    numericDisputeId: 100300,
    orderGid: "gid://shopify/Order/1",
    orderId: 1,
    status: "under_review",
    reason: "product_unacceptable",
    networkReasonCode: null,
    initiatedAt: "2026-09-01T00:00:00Z",
    evidenceDueBy: DEADLINE,
    evidenceSentOn: null,
    finalizedOn: null,
    amount: "80.00",
    currency: "EUR",
    type: "inquiry",
    disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/1",
    shopifyUpdatedAt: "2026-09-08T19:05:00Z",
    source: "webhook",
    rawSourceType: "rest_dispute_webhook",
    orderName: "#100300",
    customerDisplayName: "A",
    customerEmail: "a@example.com",
    ...over,
  } as DisputeSnapshot;
}

describe("applyDisputeSnapshot — responses observed in Shopify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("needs_response -> under_review with nothing sent records responded_via_shopify once per cycle", async () => {
    const { client, updateCalls } = setupClient(OPEN_INQUIRY);
    const result = await applyDisputeSnapshot({ shopId: "shop-1", source: "webhook", snapshot: snap({}), client });
    expect(result.outcome).toBe("applied");
    expect(updateCalls).toContainEqual({ submission_state: "responded_via_shopify" });
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "response_sent_via_shopify",
        actorType: "shopify",
        dedupeKey: "d-100300:response_sent_via_shopify:c1",
      }),
    );
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("our own save is never relabelled as a Shopify response", async () => {
    const { client, updateCalls } = setupClient({ ...OPEN_INQUIRY, submission_state: "saved_to_shopify" });
    await applyDisputeSnapshot({ shopId: "shop-1", source: "webhook", snapshot: snap({}), client });
    expect(updateCalls).not.toContainEqual({ submission_state: "responded_via_shopify" });
  });

  it("the buyer writing back (same deadline) resets to not_saved and asks for a pack, no new cycle", async () => {
    const { client, updateCalls } = setupClient({
      ...OPEN_INQUIRY,
      status: "under_review",
      submission_state: "responded_via_shopify",
    });
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: snap({ status: "needs_response", shopifyUpdatedAt: "2026-09-09T10:00:00Z" }),
      client,
    });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(updateCalls).toContainEqual({ submission_state: "not_saved" });
    expect(result.events.map((e) => e.type)).toContain("RESPONSE_REQUESTED_AGAIN");
  });

  it("first seen under review with a deadline is unattributed", async () => {
    const { client, updateCalls } = setupClient(null);
    await applyDisputeSnapshot({ shopId: "shop-1", source: "cron", snapshot: snap({}), client });
    expect(updateCalls).toContainEqual({ submission_state: "under_review_unattributed" });
  });

  it("first seen in the creation state (no deadline) is neither", async () => {
    const { client, updateCalls } = setupClient(null);
    await applyDisputeSnapshot({ shopId: "shop-1", source: "webhook", snapshot: snap({ evidenceDueBy: null }), client });
    expect(updateCalls.some((u) => "submission_state" in u)).toBe(false);
  });
});
