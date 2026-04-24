import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression: a transient PostgREST error on the existence-check SELECT made
 * syncDisputes treat a known dispute as brand new, re-firing the new-dispute
 * email ~24h after the real dispute arrived. Two guards now protect against
 * that — this test verifies both.
 *
 *   1. `existingErr !== null` → continue (skip the row entirely).
 *   2. Atomic UPDATE ... WHERE new_dispute_alert_sent_at IS NULL: even if the
 *      existence check returns `{ data: null, error: null }` incorrectly, the
 *      UPDATE finds the column already stamped on a second pass and returns
 *      zero rows, so the email never fires twice.
 */

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/shopify/graphql", () => ({
  requestShopifyGraphQL: vi.fn(),
}));
vi.mock("@/lib/security/encryption", () => ({
  deserializeEncrypted: vi.fn().mockReturnValue({}),
  decrypt: vi.fn().mockReturnValue("token-decrypted"),
}));
const { runAutomationPipeline: mockRunPipeline } = vi.hoisted(() => ({
  runAutomationPipeline: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/automation/pipeline", () => ({
  runAutomationPipeline: mockRunPipeline,
}));
vi.mock("@/lib/rules/evaluateRules", () => ({
  evaluateRules: vi
    .fn()
    .mockResolvedValue({ action: { mode: "review" }, packTemplateId: null }),
}));
vi.mock("@/lib/email/sendUnknownReasonAlert", () => ({
  sendUnknownReasonAlert: vi.fn(),
}));
vi.mock("@/lib/email/sendNewDisputeAlert", () => ({
  sendNewDisputeAlert: vi.fn(),
}));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({
  emitDisputeEvent: vi.fn(),
}));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { sendNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { syncDisputes } from "@/lib/disputes/syncDisputes";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockGraphQL = vi.mocked(requestShopifyGraphQL);
const mockSendAlert = vi.mocked(sendNewDisputeAlert);

const SHOP_ID = "shop-1";
const DISPUTE_GID = "gid://shopify/ShopifyPaymentsDispute/123";

const shopifyDispute = {
  id: DISPUTE_GID,
  type: "CHARGEBACK",
  order: { id: "gid://shopify/Order/1", name: "#1001", legacyResourceId: "1" },
  amount: { amount: "35.78", currencyCode: "USD" },
  status: "NEEDS_RESPONSE",
  finalizedOn: null,
  initiatedAt: "2026-04-19T16:11:41Z",
  evidenceDueBy: "2026-04-26T23:00:00Z",
  reasonDetails: { reason: "FRAUDULENT" },
  evidenceSentOn: null,
  disputeEvidence: null,
};

/**
 * Fake Supabase client. `existingBehavior` controls what the existence-check
 * SELECT returns; `alertAlreadySent` controls whether the atomic UPDATE finds
 * the row already stamped.
 */
function buildFakeClient(opts: {
  existingBehavior: "found" | "null-no-error" | "transient-error";
  alertAlreadySent: boolean;
}) {
  const shopRow = { id: SHOP_ID, shop_domain: "t.myshopify.com" };
  const sessionRow = {
    access_token_encrypted: "enc",
    key_version: 1,
    shop_domain: "t.myshopify.com",
  };
  const existingRow = {
    id: "dispute-1",
    status: "needs_response",
    due_at: "2026-04-26T23:00:00+00:00",
    submitted_at: null,
    final_outcome: null,
    submission_state: "not_saved",
    new_dispute_alert_sent_at: null,
  };

  const from = vi.fn((table: string) => {
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: shopRow, error: null }),
      };
    }
    if (table === "shop_sessions") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: sessionRow, error: null }),
      };
    }
    if (table === "disputes") {
      // SELECT chain for existence check, upsert chain for the insert,
      // UPDATE chain for the atomic alert-dedupe claim.
      let op: "select" | "upsert" | "update" | null = null;
      const chain: Record<string, unknown> = {
        select: vi.fn().mockImplementation(() => {
          op = op ?? "select";
          return chain;
        }),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(() => {
          if (opts.existingBehavior === "found") {
            return Promise.resolve({ data: existingRow, error: null });
          }
          if (opts.existingBehavior === "transient-error") {
            return Promise.resolve({
              data: null,
              error: { message: "PostgREST: connection reset" },
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        single: vi.fn().mockImplementation(() => {
          // upsert().select().single() — return the row id.
          return Promise.resolve({ data: { id: "dispute-1" }, error: null });
        }),
        upsert: vi.fn().mockImplementation(() => {
          op = "upsert";
          return chain;
        }),
        update: vi.fn().mockImplementation(() => {
          op = "update";
          // update().eq().is().select() → rows[] or empty if already claimed.
          const updateChain: Record<string, unknown> = {
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({
              data: opts.alertAlreadySent ? [] : [{ id: "dispute-1" }],
              error: null,
            }),
          };
          // Also allow plain `.update(...).eq(...)` (no select) — resolves ok.
          (updateChain.eq as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);
          return updateChain;
        }),
      };
      return chain;
    }
    if (table === "reason_template_mappings") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: "m1" },
          error: null,
        }),
      };
    }
    if (table === "audit_events") {
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
    };
  });

  return { from } as unknown as ReturnType<typeof getServiceClient>;
}

describe("syncDisputes — new-dispute alert dedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunPipeline.mockResolvedValue(undefined);
    mockGraphQL.mockResolvedValue({
      data: {
        disputes: {
          edges: [{ node: shopifyDispute, cursor: "c1" }],
          pageInfo: { hasNextPage: false, endCursor: "c1" },
        },
      },
      errors: undefined,
    } as never);
  });

  it("does NOT send the alert when the existence SELECT returns a transient error", async () => {
    mockGetServiceClient.mockReturnValue(
      buildFakeClient({
        existingBehavior: "transient-error",
        alertAlreadySent: false,
      }),
    );

    const result = await syncDisputes(SHOP_ID, { triggerAutomation: false });

    expect(mockSendAlert).not.toHaveBeenCalled();
    expect(result.errors.some((e) => e.includes("existence check failed"))).toBe(
      true,
    );
  });

  it("does NOT send the alert a second time when new_dispute_alert_sent_at is already stamped", async () => {
    // Simulates the original bug's downstream path: if `existing` was null due
    // to a stale read but the column was already stamped on a prior sync, the
    // atomic UPDATE finds no matching rows and the alert must not fire.
    mockGetServiceClient.mockReturnValue(
      buildFakeClient({
        existingBehavior: "null-no-error",
        alertAlreadySent: true,
      }),
    );

    await syncDisputes(SHOP_ID, { triggerAutomation: false });

    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  it("DOES send the alert on a genuinely new dispute (SELECT returns null, column not yet stamped)", async () => {
    mockGetServiceClient.mockReturnValue(
      buildFakeClient({
        existingBehavior: "null-no-error",
        alertAlreadySent: false,
      }),
    );

    await syncDisputes(SHOP_ID, { triggerAutomation: false });

    expect(mockSendAlert).toHaveBeenCalledTimes(1);
    expect(mockSendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: SHOP_ID,
        disputeId: "dispute-1",
        reason: "FRAUDULENT",
      }),
    );
  });

  it("does NOT send the review email at sync when automation enqueued a build (deferred until pack is ready)", async () => {
    mockRunPipeline.mockResolvedValue({ action: "pack_enqueued" });
    mockGetServiceClient.mockReturnValue(
      buildFakeClient({
        existingBehavior: "null-no-error",
        alertAlreadySent: false,
      }),
    );

    await syncDisputes(SHOP_ID, { triggerAutomation: true });

    expect(mockRunPipeline).toHaveBeenCalled();
    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  it("still sends at sync for review when the pipeline does not enqueue a build", async () => {
    mockRunPipeline.mockResolvedValue({ action: "skipped_auto_build_off" });
    mockGetServiceClient.mockReturnValue(
      buildFakeClient({
        existingBehavior: "null-no-error",
        alertAlreadySent: false,
      }),
    );

    await syncDisputes(SHOP_ID, { triggerAutomation: true });

    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });
});
