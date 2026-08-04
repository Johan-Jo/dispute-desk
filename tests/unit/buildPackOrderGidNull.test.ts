/**
 * Regression for the 2026-05-20 empty-pack incident.
 *
 * buildPack has a silent-failure path: when `dispute.order_gid` is NULL,
 * the order-fetch block is skipped entirely, every order-dependent
 * collector returns [], and the pack lands at score 0 with no
 * explanation. Symptom on the live #1079 dispute: "Score 6%, 1 evidence
 * items collected" — looked like a normal empty pack, was actually a
 * structural data gap upstream.
 *
 * The fix records the gap loudly:
 *   - `logAuditEvent({ eventType: "order_gid_null_at_build", … })`
 *   - `orderFetchError` populated with a self-explaining message
 *     pointing at docs/runbooks/webhook-delivery.md
 *
 * This test pins both signals. If a future refactor reverts the
 * loud-audit treatment, CI catches it before it ships.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/shopify/graphql", () => ({
  requestShopifyGraphQL: vi.fn(),
}));
const { logAuditEvent: mockLogAudit } = vi.hoisted(() => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: mockLogAudit,
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
vi.mock("@/lib/packs/sources/threeDSecureSource", () => ({
  collectThreeDSecureEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/packs/sources/fraudRiskSource", () => ({
  collectFraudRiskEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/packs/sources/coverageSource", () => ({
  collectCoverageEvidence: vi.fn().mockResolvedValue([]),
  summarizeCoverage: vi.fn().mockReturnValue({
    isCovered: false,
    status: null,
    sections: [],
  }),
}));
vi.mock("@/lib/packs/sources/deviceLocationSource", () => ({
  collectDeviceLocationEvidence: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/security/encryption", () => ({
  deserializeEncrypted: vi.fn().mockReturnValue({}),
  decrypt: vi.fn().mockReturnValue("token-decrypted"),
}));
vi.mock("@/lib/disputes/enrichNetworkReasonCode", () => ({
  enrichDisputeWithNetworkReasonCode: vi.fn().mockResolvedValue({
    result: { code: null, source: "no_reason", confidence: "low" },
  }),
}));
vi.mock("@/lib/liabilityShift/evaluateQualification", () => ({
  evaluateQualification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/automation/fatalLoss", () => ({
  detectFatalLoss: vi
    .fn()
    .mockReturnValue({ triggered: false, reason: null, summary: null }),
}));
vi.mock("@/lib/automation/riskWeakness", () => ({
  detectRiskWeakness: vi
    .fn()
    .mockResolvedValue({ triggered: false, summary: null }),
}));
vi.mock("@/lib/argument/caseStrength", () => ({
  calculateCaseStrength: vi
    .fn()
    .mockReturnValue({
      overall: "weak",
      strengthReasonI18n: { key: "disputes.strengthReason.general.weak" },
      improvementHintI18n: null,
    }),
}));
// PARTIAL mock via importOriginal. A total mock had to enumerate every
// export, so it broke the moment buildPack's dependency graph reached one it
// did not list (`REASON_TEMPLATES_V2`, 2026-08-04). The three functions below
// are the only ones this test needs to control; everything else stays real,
// so the mock cannot drift out of date again.
vi.mock("@/lib/automation/completeness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/automation/completeness")>()),
  evaluateCompleteness: vi.fn().mockReturnValue({
    score: 0,
    blockers: [],
    recommendedActions: [],
    checklist: [],
  }),
  evaluateCompletenessV2: vi.fn().mockReturnValue({
    submissionReadiness: "blocked",
    checklist: [],
    blockers: [],
    recommendedActions: [],
  }),
  deriveCompletenessMetrics: vi.fn().mockReturnValue({
    score: 0,
    blockers: [],
    recommendedActions: [],
    submissionReadiness: "blocked",
  }),
}));
vi.mock("@/lib/packs/checklistReconcile", () => ({
  reconcileChecklistWithCollectedFields: vi
    .fn()
    .mockImplementation((checklist) => checklist),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { buildPack } from "@/lib/packs/buildPack";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockGraphQL = vi.mocked(requestShopifyGraphQL);

describe("buildPack — dispute.order_gid is null (2026-05-20 regression)", () => {
  let updatePayload: Record<string, unknown> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    updatePayload = null;

    const packRow = {
      id: "p1",
      shop_id: "s1",
      dispute_id: "d1",
      pack_template_id: null,
    };
    // The whole point: order_gid is NULL.
    const disputeRow = {
      id: "d1",
      reason: "FRAUDULENT",
      order_gid: null,
      dispute_gid: "gid://shopify/ShopifyPaymentsDispute/10563485753",
    };
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
          // delete-before-insert (buildPack clears prior items on rebuild)
          delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      if (table === "shopify_orders") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  });

  it("does NOT attempt the Shopify ORDER_DETAIL_QUERY when order_gid is null", async () => {
    await buildPack("p1");
    expect(mockGraphQL).not.toHaveBeenCalled();
  });

  it("emits the order_gid_null_at_build audit event so the cause is grep-able", async () => {
    await buildPack("p1");
    const auditEvents = mockLogAudit.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditEvents).toContain("order_gid_null_at_build");
  });

  it("the audit event payload includes dispute_id + pack_id for diagnostic linking", async () => {
    await buildPack("p1");
    const nullAuditCall = mockLogAudit.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "order_gid_null_at_build",
    );
    expect(nullAuditCall).toBeDefined();
    const arg = nullAuditCall![0] as {
      disputeId: string | null;
      packId: string;
      eventPayload: { dispute_id: string; pack_id: string };
    };
    expect(arg.disputeId).toBe("d1");
    expect(arg.packId).toBe("p1");
    expect(arg.eventPayload).toMatchObject({
      dispute_id: "d1",
      pack_id: "p1",
    });
  });

  /**
   * Marking the pack 'failed' is intentional: it routes the merchant to
   * the existing failure UX (clear error + retry) instead of the
   * deceptive 'score 0% with 1 item collected' state that misled
   * everyone during the 2026-05-20 incident. The `order_gid_null_at_build`
   * audit event distinguishes the cause from a real fetch failure at the
   * server side; the merchant UX is the same.
   */
  it("marks the pack failed with order_fetch_failed (clear merchant UX, not a deceptive 'empty pack')", async () => {
    const result = await buildPack("p1");
    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("order_fetch_failed");
  });

  it("the persisted failure_reason explains that order_gid was null", async () => {
    await buildPack("p1");
    expect(updatePayload).not.toBeNull();
    expect(updatePayload!.failure_code).toBe("order_fetch_failed");
    expect(String(updatePayload!.failure_reason)).toMatch(/order_gid is null/);
  });
});
