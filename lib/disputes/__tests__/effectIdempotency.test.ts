/**
 * Tests for the Layer B effect idempotency layer:
 *   - buildDisputeEventKey / keyForTransition / keyForEffect determinism
 *   - withEffectDedup: runs the effect once on successful claim
 *   - withEffectDedup: skips the effect on unique-violation (code 23505)
 *   - withEffectDedup: surfaces non-uniqueness DB errors as claim_failed
 *   - Concurrent-overlap simulation: webhook + cron fire the same effect →
 *     only the first claim runs, the second short-circuits.
 *
 * Layer A delivery dedup (webhook_events) is tested separately in
 * lib/webhooks/__tests__/eventIdempotency.test.ts. Both layers are required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import {
  buildDisputeEventKey,
  keyForTransition,
  keyForEffect,
} from "@/lib/disputes/disputeEventKey";
import { withEffectDedup } from "@/lib/disputes/dispatchOnce";
import type { DisputeTransitionEvent } from "@/lib/disputes/applyDisputeSnapshot";

const mockGetServiceClient = vi.mocked(getServiceClient);

function makeAuditInsertClient(resolved: {
  error: { code?: string; message?: string } | null;
}) {
  const insert = vi.fn().mockResolvedValue(resolved);
  const from = vi.fn().mockReturnValue({ insert });
  const client = { from } as unknown as never;
  return { client, insert, from };
}

const SAMPLE_EVENT: DisputeTransitionEvent = {
  type: "STATUS_CHANGED",
  disputeId: "dispute-1",
  shopId: "shop-1",
  eventAt: "2026-05-19T12:00:00Z",
  eventKey: "dispute-1:STATUS_CHANGED:needs_response_under_review",
  oldStatus: "needs_response",
  newStatus: "under_review",
  context: {
    reason: "fraudulent",
    phase: "chargeback",
    amount: 432.9,
    currency: "USD",
    dueAt: "2026-05-26T12:00:00Z",
    orderGid: "gid://shopify/Order/9876",
    disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/777",
  },
};

describe("disputeEventKey builders", () => {
  it("buildDisputeEventKey concatenates parts with colons and drops empties", () => {
    expect(
      buildDisputeEventKey({
        disputeId: "d-1",
        type: "STATUS_CHANGED",
        qualifiers: ["needs_response", "under_review"],
      }),
    ).toBe("d-1:STATUS_CHANGED:needs_response:under_review");

    expect(
      buildDisputeEventKey({
        disputeId: "d-1",
        type: "DISPUTE_OPENED",
        qualifiers: [null, undefined, ""],
      }),
    ).toBe("d-1:DISPUTE_OPENED");
  });

  it("buildDisputeEventKey is deterministic — same inputs → same key", () => {
    const a = buildDisputeEventKey({
      disputeId: "d-1",
      type: "OUTCOME_DETECTED",
      qualifiers: ["won"],
    });
    const b = buildDisputeEventKey({
      disputeId: "d-1",
      type: "OUTCOME_DETECTED",
      qualifiers: ["won"],
    });
    expect(a).toBe(b);
    expect(a).toBe("d-1:OUTCOME_DETECTED:won");
  });

  it("keyForTransition returns the engine's pre-computed key", () => {
    expect(keyForTransition(SAMPLE_EVENT)).toBe(SAMPLE_EVENT.eventKey);
  });

  it("keyForEffect appends a stable :effect:<name> suffix", () => {
    expect(keyForEffect(SAMPLE_EVENT, "send_new_dispute_alert")).toBe(
      `${SAMPLE_EVENT.eventKey}:effect:send_new_dispute_alert`,
    );
  });
});

describe("withEffectDedup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the effect when the audit_events claim succeeds", async () => {
    const { client, insert } = makeAuditInsertClient({ error: null });
    mockGetServiceClient.mockReturnValue(client);

    const effect = vi.fn().mockResolvedValue("ran");
    const result = await withEffectDedup({
      shopId: "shop-1",
      disputeId: "dispute-1",
      eventKey: SAMPLE_EVENT.eventKey,
      effectName: "send_new_dispute_alert",
      effect,
      context: { reason: "fraudulent" },
    });

    expect(result).toEqual({ ran: true, result: "ran" });
    expect(effect).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith({
      shop_id: "shop-1",
      dispute_id: "dispute-1",
      actor_type: "system",
      event_type: "effect:send_new_dispute_alert",
      dispute_event_key: SAMPLE_EVENT.eventKey,
      event_payload: expect.objectContaining({
        effect_name: "send_new_dispute_alert",
        event_key: SAMPLE_EVENT.eventKey,
        reason: "fraudulent",
      }),
    });
  });

  it("skips the effect on unique-violation (already_applied)", async () => {
    const { client } = makeAuditInsertClient({
      error: { code: "23505", message: "duplicate key value" },
    });
    mockGetServiceClient.mockReturnValue(client);

    const effect = vi.fn();
    const result = await withEffectDedup({
      shopId: "shop-1",
      disputeId: "dispute-1",
      eventKey: SAMPLE_EVENT.eventKey,
      effectName: "send_new_dispute_alert",
      effect,
    });

    expect(result).toEqual({ ran: false, reason: "already_applied" });
    expect(effect).not.toHaveBeenCalled();
  });

  it("surfaces non-uniqueness DB errors as claim_failed (still does NOT run the effect)", async () => {
    const { client } = makeAuditInsertClient({
      error: { code: "08000", message: "connection failure" },
    });
    mockGetServiceClient.mockReturnValue(client);

    const effect = vi.fn();
    const result = await withEffectDedup({
      shopId: "shop-1",
      disputeId: "dispute-1",
      eventKey: SAMPLE_EVENT.eventKey,
      effectName: "send_new_dispute_alert",
      effect,
    });

    expect(result).toEqual({
      ran: false,
      reason: "claim_failed",
      error: "connection failure",
    });
    expect(effect).not.toHaveBeenCalled();
  });

  it("concurrent overlap: webhook claim wins, cron sees 23505 — effect runs exactly once", async () => {
    // First call: claim succeeds.
    const firstClient = makeAuditInsertClient({ error: null });
    // Second call: same key, unique violation.
    const secondClient = makeAuditInsertClient({
      error: { code: "23505", message: "duplicate key value" },
    });

    const sequence = [firstClient.client, secondClient.client];
    let idx = 0;
    mockGetServiceClient.mockImplementation(() => sequence[idx++]!);

    const effect = vi.fn().mockResolvedValue("ran");
    const r1 = await withEffectDedup({
      shopId: "shop-1",
      disputeId: "dispute-1",
      eventKey: SAMPLE_EVENT.eventKey,
      effectName: "enqueue_build_pack",
      effect,
    });
    const r2 = await withEffectDedup({
      shopId: "shop-1",
      disputeId: "dispute-1",
      eventKey: SAMPLE_EVENT.eventKey,
      effectName: "enqueue_build_pack",
      effect,
    });

    expect(r1).toEqual({ ran: true, result: "ran" });
    expect(r2).toEqual({ ran: false, reason: "already_applied" });
    expect(effect).toHaveBeenCalledOnce();
  });
});
