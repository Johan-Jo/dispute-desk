/**
 * The deadline cron files the last package that was actually BUILT.
 *
 * ── THE PRODUCTION SHAPE, REPRODUCED ──────────────────────────────────
 *
 * blume-box dispute 11051073729 (USD 120, FRAUDULENT/4837, due
 * 2026-08-14T23:00Z):
 *
 *   v4  stale · validation ok · PDF rendered  ← held to be filed at the deadline
 *   v5  failed · no PDF                        ← rebuilt 06:03, failed 06:11
 *
 * At 08:01 this cron read "the latest row", found v5, filed NOTHING, and told
 * the merchant to regenerate — with a validated package sitting one row below.
 * Twelve disputes were in that shape fleet-wide, one already lost.
 *
 * These cases run against the LEGACY route (the switch is off, which is what
 * production runs); the canonical route's candidate loading is covered by
 * `tests/unit/defencePackageCandidateSelection.test.ts`.
 *
 * The companion property — never walking past a candidate the SAFETY gate
 * refuses — is pinned in `defencePackageDeadlineSubmitUnsafeClaim.test.ts` and
 * must keep passing. A build that never produced a package is skipped; a
 * package that was judged and refused is not.
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
import { CLEAN_FACTS, CLEAN_NARRATIVE } from "@/tests/fixtures/defencePackageShapes";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);
const mockEmail = vi.mocked(sendDefenceDeadlineFallbackAlert);

const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";
const PACK_ID = "pack-1";

const DISPUTE = {
  id: DISPUTE_ID,
  shop_id: SHOP_ID,
  dispute_gid: "gid://shopify/ShopifyPaymentsDispute/11051073729",
  reason: "FRAUDULENT",
  amount: 120,
  currency_code: "USD",
  due_at: new Date().toISOString(),
  status: "needs_response",
  normalized_status: "new",
  review_state: null,
};

/** The failed rebuild: no PDF, no validated narrative, no artifact of any kind. */
const FAILED_V5 = {
  id: "pkg-5",
  version: 5,
  status: "failed",
  validation_status: "failed",
  pdf_path: null,
  failure_code: "validation_failed",
  content_revision: "55555555-5555-4555-8555-555555555555",
  facts_json: CLEAN_FACTS,
  narrative_json: null,
};

/** The package the pipeline held to file at this deadline. */
const GOOD_V4 = {
  id: "pkg-4",
  version: 4,
  status: "stale",
  validation_status: "ok",
  pdf_path: "defence/v4.pdf",
  failure_code: null,
  content_revision: "44444444-4444-4444-8444-444444444444",
  facts_json: CLEAN_FACTS,
  narrative_json: CLEAN_NARRATIVE,
};

function makeSupabase(defenceVersions: Array<Record<string, unknown>>) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data:
      name === "enqueue_defence_package_save"
        ? { outcome: "enqueued", job_id: "job-1" }
        : { outcome: "promoted", package_id: args.p_package_id, job_id: "job-1" },
    error: null,
  }));

  const mockFrom = vi.fn((table: string) => {
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [DISPUTE], error: null }),
      };
    }
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { id: PACK_ID, status: "ready" }, error: null }),
      };
    }
    if (table === "defence_packages") {
      // Every version is handed over, newest first — the route decides which
      // one is a candidate, so the behaviour is a property of the rule and not
      // of a `limit` argument.
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve({ data: defenceVersions, error: null })),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  mockGetServiceClient.mockReturnValue({ from: mockFrom, rpc } as never);
  return { rpc };
}

const req = () => new NextRequest("https://x.test/api/cron/defence-package-deadline-submit");

beforeEach(() => {
  vi.clearAllMocks();
  // The legacy route — what production runs. The canonical route is dark.
  delete process.env.CANONICAL_PIPELINE;
});

describe("deadline submit — a failed rebuild does not forfeit the case", () => {
  it("files the last built package when the newest version is a failed build", async () => {
    const { rpc } = makeSupabase([FAILED_V5, GOOD_V4]);

    const res = await GET(req());
    const body = await res.json();

    // v4 is promoted and enqueued — not v5, and not nothing.
    expect(rpc).toHaveBeenCalledWith(
      "finalize_defence_package",
      expect.objectContaining({
        p_package_id: GOOD_V4.id,
        p_expected_version: GOOD_V4.version,
        p_expected_revision: GOOD_V4.content_revision,
      }),
    );
    expect(body.enqueuedSubmit).toBe(1);
    expect(body.enqueuedFallback).toBe(0);

    // No "we filed nothing" email — because we filed something.
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it("records WHY an older version reached the bank", async () => {
    /* The filed version was built from an earlier evidence snapshot. A reviewer
     * reconstructing "why is v4 at the bank when v5 exists" must not have to
     * infer it from two unrelated rows. */
    makeSupabase([FAILED_V5, GOOD_V4]);
    await GET(req());

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "defence_package_last_good_version_used",
        eventPayload: expect.objectContaining({
          filedPackageId: GOOD_V4.id,
          filedVersion: 4,
          abortedVersions: [5],
        }),
      }),
    );
  });

  it("does NOT announce a fallback when the newest version is the one filed", async () => {
    makeSupabase([GOOD_V4]);
    await GET(req());

    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "defence_package_last_good_version_used" }),
    );
  });

  it("says the build FAILED, not that no package exists, when every version failed", async () => {
    /* `missing` reads to the merchant as "not generated yet — it will appear
     * when the build finishes". A build that ran and failed will not finish on
     * its own, so that is the one instruction that cannot help. */
    makeSupabase([FAILED_V5]);

    const res = await GET(req());
    const body = await res.json();

    expect(body.enqueuedSubmit).toBe(0);
    expect(body.enqueuedFallback).toBe(1);
    expect(mockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: "validation_failed" }),
    );
  });

  it("still reports `missing` when no version was ever built", async () => {
    makeSupabase([]);

    await GET(req());

    expect(mockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: "missing" }),
    );
  });
});
