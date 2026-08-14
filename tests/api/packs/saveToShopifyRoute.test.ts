/**
 * Route-level tests for POST /api/packs/:packId/save-to-shopify.
 *
 * Closes the gap from RELEASE_TESTING_PLAN.md §12: the only existing
 * route test (`failedPackGuards.test.ts`) covers two of the early-exit
 * paths (404 + 409 PACK_NOT_READY). This file adds the remaining gates
 * and the happy-path side-effects (jobs row inserted, pack flipped to
 * "saving", audit event emitted).
 *
 * The actual Shopify GraphQL call lives in the job handler — its
 * payload composition is locked by
 * `lib/jobs/handlers/__tests__/saveToShopify.snapshot.test.ts`. This
 * file deliberately stays at the route boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { POST } from "@/app/api/packs/[packId]/save-to-shopify/route";
import {
  CLEAN_FACTS,
  RETIRED_FACTS,
  narrativeJson,
} from "@/tests/fixtures/defencePackageShapes";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAuditEvent = vi.mocked(logAuditEvent);

const packId = "pack-uuid-1";
const shopId = "shop-1";
const disputeId = "dispute-1";

interface ScenarioRows {
  pack: Record<string, unknown> | null;
  dispute?: Record<string, unknown> | null;
  jobInsertError?: { message: string } | null;
  /** PR-C1: latest defence_packages candidate, if any. */
  defencePackage?: Record<string, unknown> | null;
}

interface ScenarioSpies {
  jobsInsert: ReturnType<typeof vi.fn>;
  packsUpdate: ReturnType<typeof vi.fn>;
}

/**
 * Wires a per-table Supabase mock that mirrors the route's actual
 * call sequence:
 *   1. evidence_packs.select(...).eq(id).single           → packRow
 *   2. defence_packages.select(...).order.limit.maybeSingle → latest candidate
 *   3. disputes.select(...).eq(id).single                 → disputeRow
 *   4. jobs.insert({...})                                  → ok | error
 *   5. evidence_packs.update({...}).eq(id)                 → ok
 *
 * Step 2 is the PR-C1 candidate preflight. A missing candidate BLOCKS (the
 * worker hard-requires a final package), so every non-blocking scenario
 * supplies `SAFE_PACKAGE` — which must now be genuinely FILEABLE, not merely
 * content-safe. The earlier fixture carried no `status`, no `validation_status`
 * and no `pdf_path`, so the happy path was proving that a candidate the worker
 * would certainly refuse could still be enqueued.
 */

const SAFE_PACKAGE = {
  id: "pkg-safe",
  version: 1,
  status: "final",
  validation_status: "ok",
  pdf_path: "shop-1/dispute-1/v1.pdf",
  facts_json: CLEAN_FACTS,
  narrative_json: narrativeJson({ executiveSummary: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890)." }),
};
function mockSupabase(rows: ScenarioRows): ScenarioSpies {
  const jobsInsert = vi.fn().mockResolvedValue({
    data: null,
    error: rows.jobInsertError ?? null,
  });
  const packsUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });

  const mockFrom = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: rows.pack,
          error: rows.pack ? null : { message: "PGRST116 row not found" },
        }),
        update: packsUpdate,
      };
    }
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: rows.dispute ?? null,
          error: null,
        }),
      };
    }
    if (table === "defence_packages") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: rows.defencePackage === undefined ? SAFE_PACKAGE : rows.defencePackage,
          error: null,
        }),
      };
    }
    if (table === "jobs") {
      return {
        insert: jobsInsert,
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  return { jobsInsert, packsUpdate };
}

function makeReq(body: unknown = {}) {
  return new NextRequest(
    `http://localhost/api/packs/${packId}/save-to-shopify`,
    {
      method: "POST",
      headers: new Headers({ "x-shop-id": shopId }),
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ packId }) };

describe("POST /api/packs/:packId/save-to-shopify — gates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the pack row is missing", async () => {
    mockSupabase({ pack: null });
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Pack not found");
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 422 PACK_BLOCKED when submission_readiness === 'blocked'", async () => {
    mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 90, submission_readiness: "blocked",
      },
    });
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("PACK_BLOCKED");
  });

  it("returns 422 PACK_INCOMPLETE when completeness_score === 0", async () => {
    mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 0, submission_readiness: "ready",
      },
    });
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("PACK_INCOMPLETE");
  });

  it("returns 422 PACK_HAS_WARNINGS when readiness === 'ready_with_warnings' and not confirmed", async () => {
    mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 95, submission_readiness: "ready_with_warnings",
      },
    });
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("PACK_HAS_WARNINGS");
    expect(body.readiness).toBe("ready_with_warnings");
  });

  it("returns 422 PACK_HAS_WARNINGS on legacy low-score path (score < 80, no v2 readiness)", async () => {
    mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 60, submission_readiness: null,
      },
    });
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("PACK_HAS_WARNINGS");
  });

  it("returns 400 when dispute is missing dispute_evidence_gid", async () => {
    mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 90, submission_readiness: "ready",
      },
      dispute: { id: disputeId, dispute_evidence_gid: null },
    });
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("dispute_evidence_gid");
  });
});

describe("POST /api/packs/:packId/save-to-shopify — happy path side effects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 202, enqueues a save_to_shopify job, flips pack to 'saving', and writes an audit event", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 92, submission_readiness: "ready",
      },
      dispute: {
        id: disputeId,
        dispute_evidence_gid: "gid://shopify/DisputeEvidence/12345",
      },
    });

    const res = await POST(makeReq(), params);

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ queued: true, packId });

    // Job enqueued with the right shape
    expect(spies.jobsInsert).toHaveBeenCalledTimes(1);
    expect(spies.jobsInsert).toHaveBeenCalledWith({
      shop_id: shopId,
      job_type: "save_to_shopify",
      entity_id: packId,
    });

    // Pack flipped to "saving" — the worker is responsible for
    // every status transition after this point
    expect(spies.packsUpdate).toHaveBeenCalledTimes(1);
    const updatePayload = spies.packsUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.status).toBe("saving");
    expect(typeof updatePayload.updated_at).toBe("string");

    // Audit event emitted
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId,
        disputeId,
        packId,
        actorType: "merchant",
        eventType: "evidence_saved_to_shopify",
        eventPayload: expect.objectContaining({ trigger: "manual", queued: true }),
      }),
    );
  });

  // ── PR-C1: an unsafe defence-package candidate cannot be saved manually ──
  it("returns 422 PACKAGE_REVIEW_REQUIRED and enqueues nothing when the latest package asserts an address delivery", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 95, submission_readiness: "ready",
      },
      dispute: { id: disputeId, dispute_evidence_gid: "gid://shopify/DisputeEvidence/12345" },
      defencePackage: {
        id: "pkg-3",
        version: 3,
        facts_json: CLEAN_FACTS,
        narrative_json: narrativeJson({ fulfillmentArgument: "The parcel was delivered to the cardholder's verified address on 12 May 2026." }),
      },
    });

    const res = await POST(makeReq({}), params);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe("PACKAGE_REVIEW_REQUIRED");
    expect(body.reasons).toContain("affirmative_address_delivery_claim");
    // Nothing queued, pack status untouched — no path to Shopify opens.
    expect(spies.jobsInsert).not.toHaveBeenCalled();
    expect(spies.packsUpdate).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "defence_package_blocked_unsafe_claim" }),
    );
  });

  it("returns 422 when the latest package carries a retired delivery fact", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 95, submission_readiness: "ready",
      },
      dispute: { id: disputeId, dispute_evidence_gid: "gid://shopify/DisputeEvidence/12345" },
      defencePackage: {
        id: "pkg-3",
        version: 3,
        facts_json: RETIRED_FACTS,
        narrative_json: narrativeJson({ fulfillmentArgument: "The carrier confirmed delivery on 12 May." }),
      },
    });

    const res = await POST(makeReq({}), params);
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toContain("retired_delivery_fact");
    expect(spies.jobsInsert).not.toHaveBeenCalled();
  });

  it("a regenerated SAFE version saves normally despite older blocked versions", async () => {
    // The route reads the LATEST version only — version 4 is the clean rebuild.
    const spies = mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 95, submission_readiness: "ready",
      },
      dispute: { id: disputeId, dispute_evidence_gid: "gid://shopify/DisputeEvidence/12345" },
      defencePackage: {
        ...SAFE_PACKAGE,
        id: "pkg-4",
        version: 4,
        narrative_json: narrativeJson({ fulfillmentArgument: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890)." }),
      },
    });

    const res = await POST(makeReq({}), params);
    expect(res.status).toBe(202);
    expect(spies.jobsInsert).toHaveBeenCalledTimes(1);
  });

  /* ── Fileability, not just content safety ────────────────────────────
   *
   * `saveToShopifyJob` §3 hard-requires the LATEST defence package to be
   * `status='final'` with a `pdf_path`. This route used to enqueue on content
   * safety alone AND stamp the evidence pack `saving`, so a safe draft put the
   * UI into a save-in-progress state for a job that could never complete.
   * ----------------------------------------------------------------- */

  const NOT_FILEABLE: Array<[string, Record<string, unknown>, string]> = [
    ["safe but still a DRAFT", { status: "draft" }, "candidate_not_final"],
    ["safe but STALE", { status: "stale" }, "candidate_not_final"],
    /* A `failed` row is not a candidate at all (2026-08-14) — it is a build
     * that produced no package. The refusal is unchanged; the reason is now
     * the precise one, and "not final" no longer implies there is a draft to
     * approve. */
    ["safe but FAILED", { status: "failed" }, "candidate_build_failed"],
    ["final with NO PDF", { pdf_path: null }, "candidate_missing_pdf"],
    ["final with an empty PDF path", { pdf_path: "   " }, "candidate_missing_pdf"],
    [
      "final whose VALIDATION failed",
      { validation_status: "failed" },
      "candidate_validation_not_ok",
    ],
  ];

  for (const [name, over, reason] of NOT_FILEABLE) {
    it(`refuses (${name}) — no job, no 'saving' stamp`, async () => {
      const spies = mockSupabase({
        pack: {
          id: packId, shop_id: shopId, dispute_id: disputeId,
          status: "ready", completeness_score: 95, submission_readiness: "ready",
        },
        dispute: { id: disputeId, dispute_evidence_gid: "gid://shopify/DisputeEvidence/12345" },
        defencePackage: { ...SAFE_PACKAGE, ...over },
      });

      const res = await POST(makeReq({}), params);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("PACKAGE_NOT_FILEABLE");
      expect(body.reasons).toContain(reason);
      expect(spies.jobsInsert).not.toHaveBeenCalled();
      expect(spies.packsUpdate).not.toHaveBeenCalled();
    });
  }

  it("accepts confirmWarnings: true to bypass the warnings gate", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 95, submission_readiness: "ready_with_warnings",
      },
      dispute: {
        id: disputeId,
        dispute_evidence_gid: "gid://shopify/DisputeEvidence/12345",
      },
    });

    const res = await POST(makeReq({ confirmWarnings: true }), params);

    expect(res.status).toBe(202);
    expect(spies.jobsInsert).toHaveBeenCalledTimes(1);
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("accepts legacy confirmLowCompleteness: true to bypass the low-score gate", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 60, submission_readiness: null,
      },
      dispute: {
        id: disputeId,
        dispute_evidence_gid: "gid://shopify/DisputeEvidence/12345",
      },
    });

    const res = await POST(makeReq({ confirmLowCompleteness: true }), params);
    expect(res.status).toBe(202);
    expect(spies.jobsInsert).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the jobs insert fails (does not flip pack status)", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId, shop_id: shopId, dispute_id: disputeId,
        status: "ready", completeness_score: 92, submission_readiness: "ready",
      },
      dispute: {
        id: disputeId,
        dispute_evidence_gid: "gid://shopify/DisputeEvidence/12345",
      },
      jobInsertError: { message: "duplicate job" },
    });

    const res = await POST(makeReq(), params);

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("duplicate job");

    // Crucial invariant: a failed insert must NOT leave the pack stuck
    // in "saving" — the route returns before reaching the update.
    expect(spies.packsUpdate).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });
});
