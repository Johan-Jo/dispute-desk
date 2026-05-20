/**
 * Tests for the applyDisputeSnapshot diff engine.
 *
 * The engine is the shared core for BOTH the webhook (direct processing) and
 * cron (hourly reconciliation) paths. It MUST behave identically regardless
 * of `source`, modulo the source_type recorded on emitted dispute_events.
 *
 * Covers (13 cases):
 *   1. Fresh insert (new dispute) emits DISPUTE_OPENED.
 *   2. Fresh insert that's already terminal emits OUTCOME_DETECTED + writes closed_at.
 *   3. Fresh insert with evidenceSentOn set emits SUBMISSION_CONFIRMED + writes submission_state.
 *   4. Status change emits STATUS_CHANGED.
 *   5. Status change to terminal emits OUTCOME_DETECTED + DISPUTE_CLOSED + writes closed_at.
 *   6. evidence_sent_on transition null → timestamp emits SUBMISSION_CONFIRMED.
 *   7. due_at change emits DUE_DATE_CHANGED (epoch-ms comparison, tolerates tz).
 *   8. No-op snapshot → skipped_unchanged.
 *   9. Stale snapshot (shopifyUpdatedAt < existing.shopify_updated_at) → skipped_stale.
 *  10. evidence_sent_on walk-back (timestamp → null) → guard warning, value preserved.
 *  11. Terminal-state downgrade attempt → guard warning, status not overwritten.
 *  12. Unknown shopId → skipped_unknown_shop.
 *  13. Source-agnostic: webhook vs cron produce the same upsert + same events.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({
  emitDisputeEvent: vi.fn(async () => {}),
}));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn(async () => {}),
}));

import { applyDisputeSnapshot } from "@/lib/disputes/applyDisputeSnapshot";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { updateNormalizedStatus } from "@/lib/disputeEvents/updateNormalizedStatus";
import type { DisputeSnapshot } from "@/lib/disputes/disputeSnapshot";

const mockEmit = vi.mocked(emitDisputeEvent);
const mockUpdateNormalized = vi.mocked(updateNormalizedStatus);

interface MockExistingRow {
  id: string;
  status: string | null;
  due_at: string | null;
  submitted_at: string | null;
  final_outcome: string | null;
  submission_state: string | null;
  new_dispute_alert_sent_at: string | null;
  shopify_updated_at: string | null;
  dispute_evidence_gid: string | null;
}

interface MockSetup {
  existing?: MockExistingRow | null;
  upsertedId?: string;
  upsertError?: { message: string } | null;
  existingError?: { message: string } | null;
}

/**
 * Build a fake Supabase client that supports the subset of queries
 * applyDisputeSnapshot performs: `disputes.select.eq.eq.maybeSingle`,
 * `disputes.upsert.select.single`, and `disputes.update.eq` for the side-
 * effect column writes.
 */
function setupClient(setup: MockSetup) {
  const updateCalls: Record<string, unknown>[] = [];
  const upsertCalls: Record<string, unknown>[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table !== "disputes") {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      select: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation(() => ({
          eq: vi.fn().mockImplementation(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: setup.existing ?? null,
              error: setup.existingError ?? null,
            }),
          })),
        })),
      })),
      upsert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        upsertCalls.push(row);
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: setup.upsertError
                ? null
                : { id: setup.upsertedId ?? "dispute-uuid" },
              error: setup.upsertError ?? null,
            }),
          }),
        };
      }),
      update: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        updateCalls.push(row);
        return {
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
  };

  const client = { from: fromImpl } as unknown as never;
  return { client, updateCalls, upsertCalls };
}

const BASE_SNAPSHOT: DisputeSnapshot = {
  disputeGid: "gid://shopify/DisputeEvidence/12345",
  numericDisputeId: 12345,
  orderGid: "gid://shopify/Order/9876",
  orderId: 9876,
  status: "needs_response",
  reason: "fraudulent",
  networkReasonCode: "10.4",
  initiatedAt: "2026-05-19T12:00:00Z",
  evidenceDueBy: "2026-05-26T12:00:00Z",
  evidenceSentOn: null,
  finalizedOn: null,
  amount: "432.90",
  currency: "USD",
  type: "chargeback",
  disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/777",
  shopifyUpdatedAt: "2026-05-19T12:00:01Z",
  source: "webhook",
  rawSourceType: "rest_dispute_webhook",
};

describe("applyDisputeSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. fresh insert emits DISPUTE_OPENED", async () => {
    const { client, upsertCalls } = setupClient({ existing: null });
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: BASE_SNAPSHOT,
      client,
    });

    expect(result.outcome).toBe("applied");
    expect(result.created).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe("DISPUTE_OPENED");
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({
      shop_id: "shop-1",
      dispute_gid: BASE_SNAPSHOT.disputeGid,
      status: "needs_response",
    });
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "dispute_opened" }),
    );
  });

  it("2. fresh insert already terminal emits OUTCOME_DETECTED + writes closed_at", async () => {
    const { client, updateCalls } = setupClient({ existing: null });
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: {
        ...BASE_SNAPSHOT,
        status: "won",
        finalizedOn: "2026-05-20T00:00:00Z",
      },
      client,
    });

    expect(result.outcome).toBe("applied");
    expect(result.events.map((e) => e.type)).toEqual([
      "DISPUTE_OPENED",
      "OUTCOME_DETECTED",
    ]);
    expect(updateCalls.find((u) => "closed_at" in u)).toMatchObject({
      closed_at: "2026-05-20T00:00:00Z",
    });
  });

  it("3. fresh insert with evidenceSentOn emits SUBMISSION_CONFIRMED + writes submission_state", async () => {
    const { client, updateCalls } = setupClient({ existing: null });
    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: {
        ...BASE_SNAPSHOT,
        evidenceSentOn: "2026-05-21T12:00:00Z",
      },
      client,
    });

    expect(result.events.map((e) => e.type)).toContain("SUBMISSION_CONFIRMED");
    expect(updateCalls.find((u) => "submission_state" in u)).toMatchObject({
      submission_state: "submitted_confirmed",
      submitted_at: "2026-05-21T12:00:00Z",
    });
  });

  it("4. status change emits STATUS_CHANGED", async () => {
    const { client } = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        due_at: "2026-05-26T12:00:00Z",
        submitted_at: null,
        final_outcome: null,
        submission_state: "not_saved",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: { ...BASE_SNAPSHOT, status: "under_review" },
      client,
    });

    expect(result.outcome).toBe("applied");
    expect(result.events.map((e) => e.type)).toEqual(["STATUS_CHANGED"]);
    expect(result.events[0]?.oldStatus).toBe("needs_response");
    expect(result.events[0]?.newStatus).toBe("under_review");
  });

  it("5. status change to terminal emits OUTCOME_DETECTED + DISPUTE_CLOSED + writes closed_at", async () => {
    const { client, updateCalls } = setupClient({
      existing: {
        id: "dispute-1",
        status: "under_review",
        due_at: null,
        submitted_at: null,
        final_outcome: null,
        submission_state: "submitted_confirmed",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: {
        ...BASE_SNAPSHOT,
        status: "lost",
        finalizedOn: "2026-05-22T08:00:00Z",
        evidenceDueBy: null,
      },
      client,
    });

    expect(result.events.map((e) => e.type)).toEqual([
      "STATUS_CHANGED",
      "OUTCOME_DETECTED",
      "DISPUTE_CLOSED",
    ]);
    expect(updateCalls.find((u) => "closed_at" in u)).toMatchObject({
      closed_at: "2026-05-22T08:00:00Z",
    });
  });

  it("6. evidence_sent_on transition null → timestamp emits SUBMISSION_CONFIRMED", async () => {
    const { client, updateCalls } = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        due_at: "2026-05-26T12:00:00Z",
        submitted_at: null,
        final_outcome: null,
        submission_state: "saved_to_shopify",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: {
        ...BASE_SNAPSHOT,
        evidenceSentOn: "2026-05-21T12:00:00Z",
      },
      client,
    });

    expect(result.events.map((e) => e.type)).toContain("SUBMISSION_CONFIRMED");
    expect(updateCalls.find((u) => "submission_state" in u)).toMatchObject({
      submission_state: "submitted_confirmed",
      submitted_at: "2026-05-21T12:00:00Z",
    });
  });

  it("7. due_at change emits DUE_DATE_CHANGED (epoch-ms compare)", async () => {
    const { client } = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        due_at: "2026-05-20T12:00:00Z",
        submitted_at: null,
        final_outcome: null,
        submission_state: "not_saved",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: {
        ...BASE_SNAPSHOT,
        evidenceDueBy: "2026-05-26T12:00:00Z",
      },
      client,
    });

    expect(result.events.map((e) => e.type)).toContain("DUE_DATE_CHANGED");
  });

  it("7b. same instant in different timezones does NOT emit DUE_DATE_CHANGED", async () => {
    const { client } = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        // Same instant as the snapshot below, just in a different tz offset.
        due_at: "2026-05-26T23:00:00+00:00",
        submitted_at: null,
        final_outcome: null,
        submission_state: "not_saved",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: {
        ...BASE_SNAPSHOT,
        evidenceDueBy: "2026-05-26T19:00:00-04:00",
      },
      client,
    });

    expect(result.events.map((e) => e.type)).not.toContain("DUE_DATE_CHANGED");
  });

  it("8. no-op snapshot → skipped_unchanged", async () => {
    const { client } = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        due_at: "2026-05-26T12:00:00Z",
        submitted_at: null,
        final_outcome: null,
        submission_state: "not_saved",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: BASE_SNAPSHOT,
      client,
    });

    expect(result.outcome).toBe("skipped_unchanged");
    expect(result.events).toEqual([]);
  });

  it("9. stale snapshot (shopifyUpdatedAt < existing) → skipped_stale", async () => {
    const { client } = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        due_at: "2026-05-26T12:00:00Z",
        submitted_at: null,
        final_outcome: null,
        submission_state: "not_saved",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: "2026-05-19T12:00:10Z",
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: {
        ...BASE_SNAPSHOT,
        status: "lost", // would terminalize the dispute — must NOT apply
        shopifyUpdatedAt: "2026-05-19T12:00:00Z", // older than existing
      },
      client,
    });

    expect(result.outcome).toBe("skipped_stale");
    expect(result.events).toEqual([]);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("10. evidence_sent_on walk-back is logged as a guard warning (value preserved)", async () => {
    const { client, updateCalls } = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        due_at: null,
        submitted_at: "2026-05-21T12:00:00Z",
        final_outcome: null,
        submission_state: "submitted_confirmed",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: { ...BASE_SNAPSHOT, evidenceSentOn: null },
      client,
    });

    expect(result.guardWarnings.join("|")).toMatch(/walk-back/);
    // Must NOT have re-written submission_state to anything.
    expect(updateCalls.find((u) => "submission_state" in u)).toBeUndefined();
  });

  it("11. terminal-state downgrade attempt — status not overwritten, warning emitted", async () => {
    const { client, upsertCalls } = setupClient({
      existing: {
        id: "dispute-1",
        status: "lost",
        due_at: null,
        submitted_at: null,
        final_outcome: "lost",
        submission_state: null,
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: { ...BASE_SNAPSHOT, status: "needs_response" },
      client,
    });

    expect(result.guardWarnings.join("|")).toMatch(/terminal/);
    expect(upsertCalls[0]).not.toHaveProperty("status");
  });

  it("12. unknown shopId (empty) → skipped_unknown_shop", async () => {
    const { client } = setupClient({});
    const result = await applyDisputeSnapshot({
      shopId: "",
      source: "webhook",
      snapshot: BASE_SNAPSHOT,
      client,
    });

    expect(result.outcome).toBe("skipped_unknown_shop");
    expect(result.events).toEqual([]);
  });

  it("13. source-agnostic — webhook + cron produce equivalent diff results", async () => {
    const setupA = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        due_at: "2026-05-20T12:00:00Z",
        submitted_at: null,
        final_outcome: null,
        submission_state: "not_saved",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });
    const setupB = setupClient({
      existing: {
        id: "dispute-1",
        status: "needs_response",
        due_at: "2026-05-20T12:00:00Z",
        submitted_at: null,
        final_outcome: null,
        submission_state: "not_saved",
        new_dispute_alert_sent_at: null,
        shopify_updated_at: null,
        dispute_evidence_gid: null,
      },
      upsertedId: "dispute-1",
    });

    const snap = {
      ...BASE_SNAPSHOT,
      status: "under_review",
      evidenceDueBy: "2026-05-26T12:00:00Z",
    };

    const rWebhook = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: { ...snap, source: "webhook" },
      client: setupA.client,
    });
    const rCron = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: { ...snap, source: "cron" },
      client: setupB.client,
    });

    expect(rWebhook.events.map((e) => e.type)).toEqual(
      rCron.events.map((e) => e.type),
    );
    expect(rWebhook.outcome).toBe(rCron.outcome);
  });

  it("calls updateNormalizedStatus after applying changes", async () => {
    const { client } = setupClient({ existing: null });
    await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: BASE_SNAPSHOT,
      client,
    });
    expect(mockUpdateNormalized).toHaveBeenCalledWith("dispute-uuid");
  });

  it("uses fetchDisputeDetail to backfill disputeEvidenceGid on new disputes when missing", async () => {
    const { client, upsertCalls } = setupClient({ existing: null });
    const fetchDisputeDetail = vi.fn().mockResolvedValue({
      disputeEvidenceGid:
        "gid://shopify/ShopifyPaymentsDisputeEvidence/from-graphql",
    });

    await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: { ...BASE_SNAPSHOT, disputeEvidenceGid: null },
      fetchDisputeDetail,
      client,
    });

    expect(fetchDisputeDetail).toHaveBeenCalledWith(BASE_SNAPSHOT.disputeGid);
    expect(upsertCalls[0]).toMatchObject({
      dispute_evidence_gid:
        "gid://shopify/ShopifyPaymentsDisputeEvidence/from-graphql",
    });
  });

  /**
   * Regression for the 2026-05-20 empty-pack incident.
   *
   * The webhook REST payload carries `order_id` (a number) but NOT
   * `order.admin_graphql_api_id` (the GID), `order.name`, or the
   * dispute-evidence sub-object GID. Every `build_pack` source collector
   * starts from `dispute.order_gid` — if it's NULL when build_pack runs,
   * the pack lands with score 0 / stub sections only.
   *
   * The diff engine MUST take the values returned by fetchDisputeDetail
   * and write them into the upsert row. This test pins that the wider set
   * of fields (not just disputeEvidenceGid) all reach the row.
   */
  it("fetchDisputeDetail backfills order_gid + order_name (NOT just disputeEvidenceGid)", async () => {
    const { client, upsertCalls } = setupClient({ existing: null });
    const fetchDisputeDetail = vi.fn().mockResolvedValue({
      disputeEvidenceGid:
        "gid://shopify/ShopifyPaymentsDisputeEvidence/from-graphql",
      orderGid: "gid://shopify/Order/6446376124473",
      orderName: "#1079",
    });

    await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      // Simulate the live webhook scenario: REST payload only carries
      // numeric order_id, no orderGid / orderName / disputeEvidenceGid.
      snapshot: {
        ...BASE_SNAPSHOT,
        disputeEvidenceGid: null,
        orderGid: null,
        orderName: null,
        orderId: 6446376124473,
      },
      fetchDisputeDetail,
      client,
    });

    const upsert = upsertCalls[0] ?? {};
    expect(upsert).toMatchObject({
      dispute_evidence_gid:
        "gid://shopify/ShopifyPaymentsDisputeEvidence/from-graphql",
      order_gid: "gid://shopify/Order/6446376124473",
      order_name: "#1079",
    });
  });

  /**
   * Pair-test for the seam: WITHOUT fetchDisputeDetail provided, an insert
   * driven by the sparse REST webhook payload must land with order_gid and
   * order_name NULL. This pins the "if you don't backfill, you get nothing"
   * invariant — so anyone reading the test learns that the GraphQL fetch
   * isn't optional on the webhook path.
   */
  it("WITHOUT fetchDisputeDetail, sparse REST snapshot lands with order_gid / order_name NULL", async () => {
    const { client, upsertCalls } = setupClient({ existing: null });

    await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: {
        ...BASE_SNAPSHOT,
        disputeEvidenceGid: null,
        orderGid: null,
        orderName: null,
        orderId: 6446376124473,
      },
      client,
    });

    const upsert = upsertCalls[0] ?? {};
    expect(upsert).toMatchObject({
      order_gid: null,
      // order_name is omitted from the upsert row (only written when truthy)
      // so the dispute_evidence_gid is also absent. This is the live
      // failure mode: build_pack runs against a row with no order_gid.
    });
    expect("order_name" in upsert).toBe(false);
    expect("dispute_evidence_gid" in upsert).toBe(false);
  });
});
