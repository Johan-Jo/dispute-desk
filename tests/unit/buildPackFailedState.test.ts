import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Verifies the invariant: when buildPack persists a pack with
 * status === "failed", the evidence-derived fields (completeness_score,
 * submission_readiness, blockers, recommended_actions, checklist,
 * checklist_v2) are written as null/0 — never stale scored values.
 */

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/shopify/graphql", () => ({
  requestShopifyGraphQL: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/packs/sources/orderSource", () => ({
  collectOrderEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/packs/sources/fulfillmentSource", () => ({
  collectFulfillmentEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/packs/sources/policySource", () => ({
  collectPolicyEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/packs/sources/manualSource", () => ({
  collectManualEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/packs/sources/customerCommSource", () => ({
  collectCustomerCommEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/packs/sources/paymentSource", () => ({
  collectPaymentEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/security/encryption", () => ({
  deserializeEncrypted: vi.fn().mockReturnValue({}),
  decrypt: vi.fn().mockReturnValue("token-decrypted"),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { buildPack } from "@/lib/packs/buildPack";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockGraphQL = vi.mocked(requestShopifyGraphQL);

describe("buildPack — failed-state persistence invariant", () => {
  let updatePayload: Record<string, unknown> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    updatePayload = null;

    // Pack reads return a valid pack/dispute/shop/session;
    // then waived_items lookup returns empty.
    const packRow = { id: "p1", shop_id: "s1", dispute_id: "d1", pack_template_id: null };
    const disputeRow = { id: "d1", reason: "FRAUDULENT", order_gid: "gid://order/1", dispute_gid: "gid://dispute/1" };
    const shopRow = { id: "s1", shop_domain: "test.myshopify.com" };
    const sessionRow = { access_token_encrypted: "encrypted-token" };
    const existingPackRow = { waived_items: [] };

    let evidencePacksSingleCall = 0;

    const mockFrom = vi.fn((table: string) => {
      if (table === "evidence_packs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockImplementation(() => {
            evidencePacksSingleCall += 1;
            // 1st call: load pack header. 2nd call: waived_items row.
            if (evidencePacksSingleCall === 1) {
              return Promise.resolve({ data: packRow, error: null });
            }
            return Promise.resolve({ data: existingPackRow, error: null });
          }),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            updatePayload = payload;
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
          }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === "disputes") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: disputeRow, error: null }),
        };
      }
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
      if (table === "evidence_items") {
        return {
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  });

  it("persists null/0 evidence-derived fields when order fetch fails", async () => {
    // Simulate Shopify order fetch failure → buildPack marks status="failed".
    mockGraphQL.mockRejectedValueOnce(new Error("Shopify order fetch blew up"));

    const result = await buildPack("p1");

    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("order_fetch_failed");

    expect(updatePayload).not.toBeNull();
    expect(updatePayload!.status).toBe("failed");

    // The P0 invariant: evidence-derived fields are cleaned when failed.
    expect(updatePayload!.submission_readiness).toBeNull();
    expect(updatePayload!.completeness_score).toBe(0);
    expect(updatePayload!.blockers).toBeNull();
    expect(updatePayload!.recommended_actions).toBeNull();
    expect(updatePayload!.checklist).toBeNull();
    expect(updatePayload!.checklist_v2).toBeNull();

    // failure_code / failure_reason still flow through
    expect(updatePayload!.failure_code).toBe("order_fetch_failed");
    expect(typeof updatePayload!.failure_reason).toBe("string");
  });
});
