/**
 * Response cycles (plan docs/plans/mein-maison-status-and-no-return.plan.md,
 * Fix B): the pure rules, and how applyDisputeSnapshot uses them.
 *
 * The idempotency of the ledger itself lives in SQL
 * (`reconcile_response_cycle`, migration 20260927120000) and was exercised
 * on the dev database; here the function is mocked and we pin what the diff
 * engine sends it and does with its answer.
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
import {
  hasRealDeadline,
  hasPriorResponse,
  opensNewResponseCycle,
  responseAnchorKey,
  isStaleCycle,
  reconcileResponseCycle,
  type ReconcileResponseCycleResult,
} from "@/lib/disputes/responseCycle";
import type { DisputeSnapshot } from "@/lib/disputes/disputeSnapshot";

const mockEmit = vi.mocked(emitDisputeEvent);
const mockReconcile = vi.mocked(reconcileResponseCycle);

const DEADLINE = "2026-10-01T23:59:59Z";

describe("responseCycle rules", () => {
  it("hasRealDeadline rejects null, garbage and Shopify's epoch placeholder", () => {
    expect(hasRealDeadline(null)).toBe(false);
    expect(hasRealDeadline(undefined)).toBe(false);
    expect(hasRealDeadline("not a date")).toBe(false);
    expect(hasRealDeadline("1970-01-01T00:00:00Z")).toBe(false);
    expect(hasRealDeadline(DEADLINE)).toBe(true);
  });

  it("the creation state (under_review, no deadline) is NOT a prior response", () => {
    expect(
      hasPriorResponse({
        status: "under_review",
        due_at: null,
        submitted_at: null,
        submission_state: "not_saved",
      }),
    ).toBe(false);
  });

  it("only a RECORDED response counts — under_review alone does not (inquiry messaging flips, #99143)", () => {
    const base = { status: "needs_response", due_at: DEADLINE, submitted_at: null, submission_state: "not_saved" };
    expect(hasPriorResponse({ ...base, status: "under_review" })).toBe(false);
    expect(hasPriorResponse({ ...base, submission_state: "submitted_confirmed" })).toBe(true);
    expect(hasPriorResponse({ ...base, submission_state: "saved_to_shopify" })).toBe(true);
    expect(hasPriorResponse({ ...base, submitted_at: "2026-09-01T00:00:00Z" })).toBe(true);
    expect(hasPriorResponse({ ...base, evidence_saved_to_shopify_at: "2026-09-01T00:00:00Z" })).toBe(true);
    expect(hasPriorResponse(base)).toBe(false);
  });

  it("an inquiry flipping under_review -> needs_response with nothing recorded opens no cycle", () => {
    expect(
      opensNewResponseCycle({
        existing: { status: "under_review", due_at: DEADLINE, submitted_at: null, submission_state: "not_saved" },
        newStatus: "needs_response",
        newDueAt: DEADLINE,
      }),
    ).toBe(false);
  });

  it("a new cycle needs needs_response + a real deadline + a prior response, as a transition", () => {
    const answered = {
      status: "under_review",
      due_at: "2026-09-01T00:00:00Z",
      submitted_at: "2026-08-28T10:00:00Z",
      submission_state: "submitted_confirmed",
    };
    expect(opensNewResponseCycle({ existing: answered, newStatus: "needs_response", newDueAt: DEADLINE })).toBe(true);
    // no deadline
    expect(opensNewResponseCycle({ existing: answered, newStatus: "needs_response", newDueAt: null })).toBe(false);
    // not needs_response
    expect(opensNewResponseCycle({ existing: answered, newStatus: "under_review", newDueAt: DEADLINE })).toBe(false);
    // never answered
    expect(
      opensNewResponseCycle({
        existing: { status: "under_review", due_at: null, submitted_at: null, submission_state: "not_saved" },
        newStatus: "needs_response",
        newDueAt: DEADLINE,
      }),
    ).toBe(false);
    // already needs_response: a save Shopify has not acted on yet, not a reopen
    expect(
      opensNewResponseCycle({
        existing: { ...answered, status: "needs_response", submitted_at: null, submission_state: "saved_to_shopify" },
        newStatus: "needs_response",
        newDueAt: DEADLINE,
      }),
    ).toBe(false);
  });

  it("the anchor key follows one precedence and one precision on every path", () => {
    const row = {
      status: "under_review",
      due_at: DEADLINE,
      submitted_at: "2026-05-28T04:32:50+00:00",
      submission_state: "submitted_confirmed",
      evidence_saved_to_shopify_at: "2026-05-22T15:44:52.363+00:00",
      shopify_updated_at: "2026-05-28T05:00:00Z",
    };
    expect(responseAnchorKey(row)).toBe("resp:2026-05-28T04:32:50Z");
    // Same instant, different spelling → same key.
    expect(responseAnchorKey({ ...row, submitted_at: "2026-05-28T04:32:50.000Z" })).toBe(
      "resp:2026-05-28T04:32:50Z",
    );
    expect(responseAnchorKey({ ...row, submitted_at: null })).toBe("resp:2026-05-22T15:44:52Z");
    expect(
      responseAnchorKey({ ...row, submitted_at: null, evidence_saved_to_shopify_at: null }),
    ).toBe("resp:2026-05-28T05:00:00Z");
    expect(
      responseAnchorKey({
        ...row,
        status: "needs_response",
        submitted_at: null,
        evidence_saved_to_shopify_at: null,
      }),
    ).toBeNull();
  });

  it("isStaleCycle treats a missing value as cycle 1", () => {
    expect(isStaleCycle(1, 1)).toBe(false);
    expect(isStaleCycle(null, undefined)).toBe(false);
    expect(isStaleCycle(1, 2)).toBe(true);
    expect(isStaleCycle(undefined, 2)).toBe(true);
    expect(isStaleCycle(2, 2)).toBe(false);
  });
});

// ── applyDisputeSnapshot integration ────────────────────────────────────

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
  evidence_saved_to_shopify_at?: string | null;
  response_cycle?: number | null;
  reopened_at?: string | null;
  escalated_from_inquiry_at?: string | null;
}

function setupClient(existing: Existing) {
  const updateCalls: Record<string, unknown>[] = [];
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.eq = vi.fn(() => c);
    c.is = vi.fn(() => c);
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
          single: vi.fn().mockResolvedValue({ data: { id: existing.id }, error: null }),
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

const ANSWERED: Existing = {
  id: "d-99142",
  status: "under_review",
  due_at: "2026-09-10T23:59:59Z",
  submitted_at: "2026-09-05T10:00:00Z",
  final_outcome: null,
  submission_state: "submitted_confirmed",
  new_dispute_alert_sent_at: "2026-09-01T00:00:00Z",
  shopify_updated_at: "2026-09-05T10:00:05Z",
  dispute_evidence_gid: "gid://shopify/ShopifyPaymentsDisputeEvidence/1",
  phase: "chargeback",
  evidence_saved_to_shopify_at: "2026-09-05T09:59:00Z",
  response_cycle: 1,
  reopened_at: null,
  escalated_from_inquiry_at: null,
};

const REOPEN_SNAPSHOT: DisputeSnapshot = {
  disputeGid: "gid://shopify/ShopifyPaymentsDispute/99142",
  numericDisputeId: 99142,
  orderGid: "gid://shopify/Order/1",
  orderId: 1,
  status: "needs_response",
  reason: "product_not_received",
  networkReasonCode: null,
  initiatedAt: "2026-09-01T00:00:00Z",
  evidenceDueBy: DEADLINE,
  evidenceSentOn: null,
  finalizedOn: null,
  amount: "120.00",
  currency: "EUR",
  type: "chargeback",
  disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/1",
  shopifyUpdatedAt: "2026-09-20T08:00:00Z",
  source: "webhook",
  rawSourceType: "rest_dispute_webhook",
};

function reconciled(over: Partial<ReconcileResponseCycleResult>): ReconcileResponseCycleResult {
  return {
    inserted: true,
    reset: true,
    cycle: 2,
    reopenedAt: "2026-09-20T08:00:00Z",
    previous: {
      submitted_at: ANSWERED.submitted_at,
      submission_state: "submitted_confirmed",
      review_state: null,
      evidence_saved_to_shopify_at: ANSWERED.evidence_saved_to_shopify_at ?? null,
    },
    retiredPackIds: ["pack-old"],
    retiredApprovals: [],
    supersededDefencePackageIds: ["dp-old"],
    restampedPackIds: [],
    ...over,
  };
}

describe("applyDisputeSnapshot — response cycles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a reopen calls reconcile with the prior response as anchor and Shopify's time as start", async () => {
    mockReconcile.mockResolvedValue(reconciled({}));
    const { client } = setupClient(ANSWERED);
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: REOPEN_SNAPSHOT,
      client,
    });

    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile.mock.calls[0]![1]).toBe("d-99142");
    expect(mockReconcile.mock.calls[0]![2]).toEqual({
      anchorKey: "resp:2026-09-05T10:00:00Z",
      startedAt: "2026-09-20T08:00:00Z",
      trigger: "reopen",
      source: "live",
    });
    expect(result.outcome).toBe("applied");

    const reopened = result.events.find((e) => e.type === "RESPONSE_CYCLE_REOPENED");
    expect(reopened?.eventKey).toBe("d-99142:RESPONSE_CYCLE_REOPENED:resp:2026-09-05T10:00:00Z");
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "response_cycle_reopened",
        dedupeKey: "d-99142:RESPONSE_CYCLE_REOPENED:resp:2026-09-05T10:00:00Z",
      }),
    );

    // The walk-back guard does not warn for the sanctioned reset.
    expect(result.guardWarnings.some((w) => w.includes("walk-back"))).toBe(false);
  });

  it("STATUS_CHANGED keys carry the cycle, so a second reopen is not dropped", async () => {
    mockReconcile.mockResolvedValue(reconciled({ cycle: 3 }));
    const { client } = setupClient({ ...ANSWERED, response_cycle: 2, reopened_at: "2026-09-12T00:00:00Z" });
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: REOPEN_SNAPSHOT,
      client,
    });
    const status = result.events.find((e) => e.type === "STATUS_CHANGED");
    expect(status?.eventKey).toBe("d-99142:STATUS_CHANGED:under_review_needs_response:c3");
  });

  it("a known anchor (reconcile inserted nothing) emits no second reopen", async () => {
    mockReconcile.mockResolvedValue(
      reconciled({ inserted: false, reset: false, retiredPackIds: [], supersededDefencePackageIds: [] }),
    );
    const { client } = setupClient(ANSWERED);
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: REOPEN_SNAPSHOT,
      client,
    });
    expect(result.events.some((e) => e.type === "RESPONSE_CYCLE_REOPENED")).toBe(false);
    expect(mockEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "response_cycle_reopened" }),
    );
  });

  it("a plain evidence_sent_on walk-back (no new cycle) still warns and never reconciles", async () => {
    const { client } = setupClient(ANSWERED);
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: { ...REOPEN_SNAPSHOT, status: "under_review", evidenceDueBy: ANSWERED.due_at },
      client,
    });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(result.guardWarnings.some((w) => w.includes("walk-back"))).toBe(true);
  });

  it("an inquiry answered then escalated records the escalation once and opens the cycle as 'escalation'", async () => {
    mockReconcile.mockResolvedValue(reconciled({}));
    const { client, updateCalls } = setupClient({ ...ANSWERED, id: "d-99348", phase: "inquiry" });
    await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: REOPEN_SNAPSHOT, // type chargeback
      client,
    });
    expect(updateCalls).toContainEqual({ escalated_from_inquiry_at: "2026-09-20T08:00:00Z" });
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "escalated_to_chargeback",
        dedupeKey: "d-99348:ESCALATED_TO_CHARGEBACK",
      }),
    );
    expect(mockReconcile.mock.calls[0]![2]).toMatchObject({ trigger: "escalation" });
  });

  it("an escalation of an unanswered inquiry records the escalation but opens no cycle", async () => {
    const { client } = setupClient({
      ...ANSWERED,
      phase: "inquiry",
      status: "needs_response",
      submitted_at: null,
      submission_state: "not_saved",
      evidence_saved_to_shopify_at: null,
    });
    await applyDisputeSnapshot({ shopId: "shop-1", source: "webhook", snapshot: REOPEN_SNAPSHOT, client });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "escalated_to_chargeback" }),
    );
  });

  it("a stale evidence_sent_on from the previous cycle does not re-confirm the new cycle", async () => {
    const { client, updateCalls } = setupClient({
      ...ANSWERED,
      status: "needs_response",
      submitted_at: null,
      submission_state: "not_saved",
      response_cycle: 2,
      reopened_at: "2026-09-20T08:00:00Z",
    });
    await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: { ...REOPEN_SNAPSHOT, evidenceSentOn: "2026-09-05T10:00:00Z", shopifyUpdatedAt: "2026-09-21T00:00:00Z" },
      client,
    });
    expect(updateCalls.some((u) => u.submission_state === "submitted_confirmed")).toBe(false);
  });

  it("an evidence_sent_on AFTER the cycle start does confirm the new cycle", async () => {
    const { client, updateCalls } = setupClient({
      ...ANSWERED,
      status: "needs_response",
      submitted_at: null,
      submission_state: "not_saved",
      response_cycle: 2,
      reopened_at: "2026-09-20T08:00:00Z",
    });
    await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: {
        ...REOPEN_SNAPSHOT,
        status: "under_review",
        evidenceSentOn: "2026-09-25T10:00:00Z",
        shopifyUpdatedAt: "2026-09-25T10:00:05Z",
      },
      client,
    });
    expect(updateCalls).toContainEqual({
      submission_state: "submitted_confirmed",
      submitted_at: "2026-09-25T10:00:00Z",
    });
  });

  it("a reconcile failure is a guard warning, never a failed sync", async () => {
    mockReconcile.mockRejectedValue(new Error("boom"));
    const { client } = setupClient(ANSWERED);
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: REOPEN_SNAPSHOT,
      client,
    });
    expect(result.outcome).toBe("applied");
    expect(result.guardWarnings.some((w) => w.includes("reconcileResponseCycle failed"))).toBe(true);
  });
});
