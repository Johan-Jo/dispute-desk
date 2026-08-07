/**
 * PR-C1 — `evaluateAndMaybeAutoSave` must not claim a Shopify save for a
 * candidate the worker is going to refuse.
 *
 * The auto-save branch stamps `status = saved_to_shopify` + `saved_to_shopify_at`
 * and enqueues in the same breath, so every UI, email and metric reads that as
 * "the evidence was saved". A blocked attempt has to be refused BEFORE the
 * stamp; blocking only in the worker leaves a dispute that looks filed and is
 * not.
 *
 * SCOPE: the optimistic stamp itself is pre-existing behaviour and is left
 * alone for the SAFE path — see the PR description's dependency note.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../packageReviewRequired", () => ({
  markPackageReviewRequired: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../settings", () => ({
  getShopSettings: vi.fn().mockResolvedValue({
    auto_save_enabled: true,
    auto_save_min_score: 50,
    enforce_no_blockers: false,
  }),
}));
vi.mock("@/lib/rules/evaluateRules", () => ({
  evaluateRules: vi.fn().mockResolvedValue({ action: { mode: "auto" }, matchedRule: null }),
}));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({ emitDisputeEvent: vi.fn() }));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn(),
}));
vi.mock("@/lib/email/sendNewDisputeAlert", () => ({
  claimAndSendDeferredNewDisputeAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendHighValueReviewAlert", () => ({
  sendHighValueReviewAlert: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { markPackageReviewRequired } from "../packageReviewRequired";
import { evaluateAndMaybeAutoSave } from "../pipeline";

const mockClient = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);
const mockMark = vi.mocked(markPackageReviewRequired);

const PACK_ID = "pack-1";
const DISPUTE_ID = "dispute-1";

const PACK = {
  id: PACK_ID,
  shop_id: "shop-1",
  dispute_id: DISPUTE_ID,
  status: "ready",
  completeness_score: 90,
  blockers: [],
  submission_readiness: "ready",
  pack_json: { case_strength: { overall: "strong" } },
};

const FACT = {
  id: "f1",
  category: "delivery_proof",
  label: "Delivery confirmation",
  source: "shopify_fulfillments",
  sourceRef: null,
  strength: "moderate",
  bankEligible: true,
  merchantVisible: true,
  internalOnly: false,
  includeInBankNarrative: true,
  submissionRisk: false,
  confidence: null,
  value: { proofType: "delivered_confirmed" },
};

const UNSAFE_PKG = {
  id: "pkg-3",
  version: 3,
  facts_json: [FACT],
  narrative_json: {
    fulfillmentArgument: { text: "The parcel was delivered to the cardholder's verified address." },
  },
};
const SAFE_PKG = {
  id: "pkg-4",
  version: 4,
  facts_json: [FACT],
  narrative_json: {
    fulfillmentArgument: {
      text: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890).",
    },
  },
};

/** Same wiring, but the defence_packages query fails. */
function mockSbError() {
  return mockSb(null, { message: "connection reset" });
}

function mockSb(
  latestPkg: Record<string, unknown> | null,
  queryError: { message: string } | null = null,
) {
  const packUpdates: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const from = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: PACK, error: null }),
        update: vi.fn((values: Record<string, unknown>) => {
          packUpdates.push(values);
          return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }),
      };
    }
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: DISPUTE_ID, reason: "FRAUDULENT", status: "needs_response", amount: 100, phase: "chargeback" },
          error: null,
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      };
    }
    if (table === "defence_packages") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: queryError ? null : latestPkg, error: queryError }),
      };
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn((values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return Promise.resolve({ data: null, error: null });
      }),
    };
  });
  mockClient.mockReturnValue({ from } as never);
  return { packUpdates, inserts };
}

beforeEach(() => vi.clearAllMocks());

describe("evaluateAndMaybeAutoSave — PR-C1 unsafe-candidate block", () => {
  it("does NOT stamp saved_to_shopify and does NOT enqueue for an unsafe candidate", async () => {
    const { packUpdates, inserts } = mockSb(UNSAFE_PKG);

    const result = await evaluateAndMaybeAutoSave(PACK_ID);

    expect(result.action).toBe("park_for_review");
    expect(String(result.details)).toContain("defence_package_unsafe_claim");

    // No optimistic success state of any kind.
    for (const patch of packUpdates) {
      expect(patch.status).not.toBe("saved_to_shopify");
      expect(patch.saved_to_shopify_at).toBeUndefined();
    }
    expect(inserts.some((i) => i.table === "jobs")).toBe(false);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "defence_package_blocked_unsafe_claim",
        eventPayload: expect.objectContaining({ trigger: "auto_save" }),
      }),
    );
    // The merchant is left with a typed review-required state, not a dead job.
    expect(mockMark).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disputeId: DISPUTE_ID, packageId: "pkg-3" }),
    );
  });

  it("does NOT stamp or enqueue for an unreadable candidate", async () => {
    const { packUpdates, inserts } = mockSb({
      id: "pkg-3",
      version: 3,
      facts_json: null,
      narrative_json: null,
    });
    const result = await evaluateAndMaybeAutoSave(PACK_ID);
    expect(result.action).toBe("park_for_review");
    for (const patch of packUpdates) expect(patch.status).not.toBe("saved_to_shopify");
    expect(inserts.some((i) => i.table === "jobs")).toBe(false);
  });

  it("auto-saves normally when the latest candidate is safe", async () => {
    const { packUpdates, inserts } = mockSb(SAFE_PKG);
    const result = await evaluateAndMaybeAutoSave(PACK_ID);
    expect(result.action).toBe("auto_save");
    expect(packUpdates.some((p) => p.status === "saved_to_shopify")).toBe(true);
    expect(inserts.some((i) => i.table === "jobs")).toBe(true);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("DEFERS when no defence package exists yet — no stamp, no job", async () => {
    // `saveToShopifyJob` hard-requires a latest `final` package, so a job
    // queued now is a job the worker must reject, and the accompanying
    // `saved_to_shopify` stamp was a knowingly false saved state.
    // `buildDefencePackageJob` re-resolves the rule mode after the build and
    // calls `finalizeAndEnqueueSave` itself, so the save still happens.
    const { packUpdates, inserts } = mockSb(null);
    const result = await evaluateAndMaybeAutoSave(PACK_ID);
    expect(result.action).toBe("defer_no_package");
    expect(result.details).toBe("no_defence_package_yet");
    for (const patch of packUpdates) {
      expect(patch.status).not.toBe("saved_to_shopify");
      expect(patch.saved_to_shopify_at).toBeUndefined();
    }
    expect(inserts.some((i) => i.table === "jobs")).toBe(false);
    // Not a merchant problem: no review-required banner for a pending build.
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("DEFERS on a preflight query error — a database failure is not safety", async () => {
    const { packUpdates, inserts } = mockSbError();
    const result = await evaluateAndMaybeAutoSave(PACK_ID);
    expect(result.action).toBe("defer_no_package");
    expect(result.details).toBe("preflight_error");
    for (const patch of packUpdates) expect(patch.status).not.toBe("saved_to_shopify");
    expect(inserts.some((i) => i.table === "jobs")).toBe(false);
    expect(mockMark).not.toHaveBeenCalled();
  });
});
