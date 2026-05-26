/**
 * Regression: webhook ingest MUST populate `customer_display_name` +
 * `customer_email` on the new disputes row.
 *
 * 2026-05-25 incident (dispute #5DF25744):
 *   - Webhook ingest path was promoted to primary in commit ad4cc186 but the
 *     denormalized customer columns were never copied over from the cron
 *     path (syncDisputes.ts patches them AFTER applyDisputeSnapshot).
 *   - Result: every new dispute showed "Customer: —" on the embedded detail
 *     card for up to ~1 hour, until the next cron tick patched the row.
 *
 * Contract pinned by this test:
 *   1. The DisputeSnapshot type carries `customerDisplayName` + `customerEmail`.
 *   2. The webhook `fetchDisputeDetail` GraphQL backfill resolves them on
 *      brand-new inserts when the snapshot itself does not carry them
 *      (REST payload doesn't).
 *   3. `applyDisputeSnapshot` writes them into the upsert row using the
 *      same conditional-write pattern as `order_name` / `order_gid` so
 *      back-to-back create+update from Shopify can't clobber them with
 *      null.
 *
 * If you change applyDisputeSnapshot's upsert row, the customer-column
 * write block must remain. Removing it without a documented replacement
 * is the failure mode this test exists to catch.
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
import type { DisputeSnapshot } from "@/lib/disputes/disputeSnapshot";

interface MockSetup {
  existing?: { id: string } | null;
  upsertedId?: string;
}

function setupClient(setup: MockSetup) {
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
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: setup.existing ?? null, error: null }),
          })),
        })),
      })),
      upsert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        upsertCalls.push(row);
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: setup.upsertedId ?? "dispute-uuid" },
              error: null,
            }),
          }),
        };
      }),
      update: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    };
  };

  const client = { from: fromImpl } as unknown as never;
  return { client, upsertCalls };
}

const BASE_WEBHOOK_SNAPSHOT: DisputeSnapshot = {
  disputeGid: "gid://shopify/ShopifyPaymentsDispute/10575315001",
  numericDisputeId: 10575315001,
  orderGid: null,
  orderId: 9876,
  orderName: null,
  customerDisplayName: null, // REST webhook payload never carries this
  customerEmail: null, // REST webhook payload never carries this
  status: "needs_response",
  reason: "fraudulent",
  networkReasonCode: "10.4",
  initiatedAt: "2026-05-25T22:55:00Z",
  evidenceDueBy: "2026-06-01T22:55:00Z",
  evidenceSentOn: null,
  finalizedOn: null,
  amount: "167.64",
  currency: "USD",
  type: "chargeback",
  disputeEvidenceGid: null,
  shopifyUpdatedAt: "2026-05-25T22:55:01Z",
  source: "webhook",
  rawSourceType: "rest_dispute_webhook",
};

describe("[REGRESSION] webhook ingest writes customer_display_name + customer_email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("brand-new dispute: fetchDisputeDetail returns customer name + email → upsert row carries them", async () => {
    const { client, upsertCalls } = setupClient({ existing: null });

    const fetchDisputeDetail = vi.fn(async () => ({
      disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/777",
      orderGid: "gid://shopify/Order/9876",
      orderName: "#1082",
      customerDisplayName: "Jane Customer",
      customerEmail: "jane@example.com",
    }));

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: BASE_WEBHOOK_SNAPSHOT,
      fetchDisputeDetail,
      client,
    });

    expect(result.outcome).toBe("applied");
    expect(result.created).toBe(true);
    expect(fetchDisputeDetail).toHaveBeenCalledTimes(1);

    // The whole point of this regression test: the upsert MUST include the
    // customer columns. If a future refactor removes this, the embedded
    // dispute card shows "Customer: —" until the hourly cron patches it.
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]).toMatchObject({
      customer_display_name: "Jane Customer",
      customer_email: "jane@example.com",
    });
  });

  it("snapshot already carries customer fields (cron path) → upsert row carries them WITHOUT fetchDisputeDetail", async () => {
    const { client, upsertCalls } = setupClient({ existing: null });

    const result = await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "cron",
      snapshot: {
        ...BASE_WEBHOOK_SNAPSHOT,
        source: "cron",
        rawSourceType: "graphql_dispute",
        customerDisplayName: "Bob Buyer",
        customerEmail: "bob@example.com",
      },
      client,
    });

    expect(result.outcome).toBe("applied");
    expect(upsertCalls[0]).toMatchObject({
      customer_display_name: "Bob Buyer",
      customer_email: "bob@example.com",
    });
  });

  it("backfill returns null fields → upsert row omits the columns (does NOT write null)", async () => {
    // The conditional-write pattern protects the create's value from being
    // clobbered by a back-to-back update from Shopify (see the order_gid
    // 2026-05-20 #1081 incident the upsert-row comment describes).
    const { client, upsertCalls } = setupClient({ existing: null });

    const fetchDisputeDetail = vi.fn(async () => ({
      disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/777",
      orderGid: null,
      orderName: null,
      customerDisplayName: null,
      customerEmail: null,
    }));

    await applyDisputeSnapshot({
      shopId: "shop-1",
      source: "webhook",
      snapshot: BASE_WEBHOOK_SNAPSHOT,
      fetchDisputeDetail,
      client,
    });

    expect(upsertCalls[0]).not.toHaveProperty("customer_display_name");
    expect(upsertCalls[0]).not.toHaveProperty("customer_email");
  });
});
