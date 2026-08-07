/**
 * PR-C1 — deadline processing must NOT file an unsafe defence-package
 * candidate, must notify the merchant instead, and must never walk back to an
 * older version to find something fileable.
 *
 * The last point is the load-bearing one: on this fleet the older versions are
 * precisely the unsafe ones, so a "find the newest safe version" fallback
 * would be a fallback INTO the defect.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendDefenceDeadlineFallbackAlert", () => ({
  sendDefenceDeadlineFallbackAlert: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/featureFlags", () => ({ isDefencePackageBuilderEnabled: () => true }));
vi.mock("@/lib/cron/envGate", () => ({ cronEnvGate: () => null }));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { sendDefenceDeadlineFallbackAlert } from "@/lib/email/sendDefenceDeadlineFallbackAlert";
import { GET } from "@/app/api/cron/defence-package-deadline-submit/route";
import { NextRequest } from "next/server";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);
const mockEmail = vi.mocked(sendDefenceDeadlineFallbackAlert);

const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";
const PACK_ID = "pack-1";

const DISPUTE = {
  id: DISPUTE_ID,
  shop_id: SHOP_ID,
  dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1",
  reason: "fraudulent",
  amount: 100,
  currency_code: "USD",
  due_at: new Date().toISOString(),
  status: "needs_response",
  normalized_status: "in_progress",
  review_state: null,
};

const UNSAFE_NARRATIVE = {
  fulfillmentArgument: {
    text: "The parcel was delivered to the cardholder's verified address on 12 May 2026.",
  },
};
const CLEAN_NARRATIVE = {
  fulfillmentArgument: {
    text: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890).",
  },
};

/** All defence_packages rows for the dispute, newest version first. The route
 *  must only ever consult the first one. */
function makeSupabase(defenceVersions: Array<Record<string, unknown>>) {
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const defenceUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  /** Which rows the route actually asked for — proves no older-version scan. */
  const defenceQueries: Array<{ limit?: number }> = [];

  const mockFrom = vi.fn((table: string) => {
    if (table === "disputes") {
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [DISPUTE], error: null }),
      };
      return chain;
    }
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: PACK_ID, status: "ready" },
          error: null,
        }),
      };
    }
    if (table === "defence_packages") {
      const q: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn((n: number) => {
          defenceQueries.push({ limit: n });
          return q;
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: defenceVersions[0] ?? null,
          error: null,
        }),
        update: defenceUpdate,
      };
      return q;
    }
    if (table === "jobs") return { insert: jobsInsert };
    throw new Error(`unexpected table: ${table}`);
  });

  mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  return { jobsInsert, defenceUpdate, defenceQueries };
}

const req = () => new NextRequest("https://x.test/api/cron/defence-package-deadline-submit");

beforeEach(() => vi.clearAllMocks());

describe("deadline submit — PR-C1 unsafe candidate", () => {
  it("files NOTHING and notifies the merchant when the latest candidate is unsafe", async () => {
    const { jobsInsert, defenceUpdate } = makeSupabase([
      {
        id: "pkg-3",
        version: 3,
        status: "final",
        validation_status: "ok",
        pdf_path: "p.pdf",
        failure_code: null,
        facts_json: [{
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
  }],
        narrative_json: UNSAFE_NARRATIVE,
      },
    ]);

    const res = await GET(req());
    const body = await res.json();

    // Nothing enqueued, nothing finalized — no path to Shopify opens.
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(defenceUpdate).not.toHaveBeenCalled();
    expect(body.enqueuedSubmit).toBe(0);
    expect(body.enqueuedAutoFinalize).toBe(0);
    expect(body.enqueuedFallback).toBe(1);

    // Merchant notified, with the dedicated reason.
    expect(mockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: "unsafe_address_claim" }),
    );
    expect(body.emailed).toBe(1);

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "defence_package_blocked_unsafe_claim",
        eventPayload: expect.objectContaining({ trigger: "deadline_cron_no_fallback" }),
      }),
    );
  });

  it("blocks a FINAL unsafe candidate — 'already finalized, just submit' must not bypass the gate", async () => {
    const { jobsInsert } = makeSupabase([
      {
        id: "pkg-3", version: 3, status: "final", validation_status: "ok",
        pdf_path: "p.pdf", failure_code: null,
        facts_json: [{
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
    value: { deliveredToVerifiedAddress: true },
  }],
        narrative_json: CLEAN_NARRATIVE,
      },
    ]);
    const res = await GET(req());
    expect(jobsInsert).not.toHaveBeenCalled();
    expect((await res.json()).enqueuedSubmit).toBe(0);
  });

  it("never scans older versions looking for a fileable one", async () => {
    const { defenceQueries, jobsInsert } = makeSupabase([
      {
        id: "pkg-3", version: 3, status: "final", validation_status: "ok",
        pdf_path: "p.pdf", failure_code: null,
        facts_json: [], narrative_json: UNSAFE_NARRATIVE,
      },
    ]);
    await GET(req());
    // Exactly one candidate lookup, limited to one row: the latest.
    expect(defenceQueries).toEqual([{ limit: 1 }]);
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("a regenerated SAFE latest version is submitted normally", async () => {
    const { jobsInsert } = makeSupabase([
      {
        id: "pkg-4", version: 4, status: "final", validation_status: "ok",
        pdf_path: "p.pdf", failure_code: null,
        facts_json: [{
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
  }],
        narrative_json: CLEAN_NARRATIVE,
      },
    ]);
    const res = await GET(req());
    const body = await res.json();
    expect(jobsInsert).toHaveBeenCalledTimes(1);
    expect(body.enqueuedSubmit).toBe(1);
    expect(mockEmail).not.toHaveBeenCalled();
  });
});
