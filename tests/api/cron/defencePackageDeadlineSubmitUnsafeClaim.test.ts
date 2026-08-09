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
// CP-C (R3): the deadline cron now consults the ONE canonical automation
// decision before it files anything, and the decision takes the shop's
// automation policy as an input. This route previously consulted no strength,
// no completeness, no coverage and no guards at all.
vi.mock("@/lib/automation/settings", () => ({
  getShopSettings: vi.fn().mockResolvedValue({
    auto_build_enabled: true,
    auto_save_enabled: true,
    auto_save_min_score: 60,
    enforce_no_blockers: true,
  }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { sendDefenceDeadlineFallbackAlert } from "@/lib/email/sendDefenceDeadlineFallbackAlert";
import { GET } from "@/app/api/cron/defence-package-deadline-submit/route";
import { NextRequest } from "next/server";
import {
  CLEAN_FACTS,
  CLEAN_NARRATIVE,
  RETIRED_FACTS,
  UNSAFE_NARRATIVE,
} from "@/tests/fixtures/defencePackageShapes";

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


/** All defence_packages rows for the dispute, newest version first. The route
 *  must only ever consult the first one. */
interface CronScenario {
  /** What `enqueue_defence_package_save` / `finalize_defence_package` return. */
  rpcResult?: unknown;
  rpcError?: { message: string } | null;
}

function makeSupabase(
  defenceVersions: Array<Record<string, unknown>>,
  scenario: CronScenario = {},
) {
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const rpc = vi.fn(async (name: string) => {
    if (scenario.rpcError) return { data: null, error: scenario.rpcError };
    if ("rpcResult" in scenario) return { data: scenario.rpcResult, error: null };
    return {
      data:
        name === "enqueue_defence_package_save"
          ? { outcome: "enqueued", job_id: "job-1" }
          : {
              outcome: "promoted",
              package_id: (defenceVersions[0] as { id?: string } | undefined)?.id ?? "pkg",
              job_id: "job-1",
            },
      error: null,
    };
  });
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
          // CP-C decision inputs. A real ready pack always carries these
          // (`submission_readiness` is NOT NULL); the fixture never needed them
          // while this route filed without consulting anything.
          data: {
            id: PACK_ID,
            status: "ready",
            completeness_score: 90,
            blockers: [],
            submission_readiness: "ready",
            pack_json: {
              case_strength: { overall: "strong" },
              coverage: { state: "not_covered" },
              fatal_loss: { triggered: false },
            },
          },
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

  mockGetServiceClient.mockReturnValue({ from: mockFrom, rpc } as never);
  return { jobsInsert, defenceUpdate, defenceQueries, rpc };
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
        content_revision: "11111111-1111-4111-8111-111111111111",
        facts_json: CLEAN_FACTS,
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
        pdf_path: "p.pdf", failure_code: null, content_revision: "11111111-1111-4111-8111-111111111111",
        facts_json: RETIRED_FACTS,
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
        pdf_path: "p.pdf", failure_code: null, content_revision: "11111111-1111-4111-8111-111111111111",
        facts_json: [], narrative_json: UNSAFE_NARRATIVE,
      },
    ]);
    await GET(req());
    // Exactly one candidate lookup, limited to one row: the latest.
    expect(defenceQueries).toEqual([{ limit: 1 }]);
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  const safeFinal = () => [
    {
      id: "pkg-4", version: 4, status: "final", validation_status: "ok",
      pdf_path: "p.pdf", failure_code: null,
      content_revision: "11111111-1111-4111-8111-111111111111",
      facts_json: CLEAN_FACTS,
      narrative_json: CLEAN_NARRATIVE,
    },
  ];

  /* ── The already-final branch goes through the enqueue TRANSACTION ─────
   *
   * It used to be a bare `jobs.insert` whose result was IGNORED, so a failed
   * insert was still counted as `enqueuedSubmit` — on the last-day cron, the
   * worst possible place to over-report. It also skipped the currency,
   * revision and fileability checks the transaction performs.
   * ------------------------------------------------------------------ */

  it("a regenerated SAFE latest version is submitted through the enqueue RPC", async () => {
    const { jobsInsert, rpc } = makeSupabase(safeFinal());
    const res = await GET(req());
    const body = await res.json();
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "enqueue_defence_package_save",
      expect.objectContaining({ p_package_id: "pkg-4" }),
    );
    expect(body.enqueuedSubmit).toBe(1);
    expect(mockEmail).not.toHaveBeenCalled();
  });

  it("an ALREADY-QUEUED save still counts as submitted, without a second job", async () => {
    const { jobsInsert } = makeSupabase(safeFinal(), {
      rpcResult: { outcome: "already_done", reason: "save_already_queued", job_id: "job-9" },
    });
    const body = await (await GET(req())).json();
    expect(body.enqueuedSubmit).toBe(1);
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  const REFUSALS: Array<[string, CronScenario]> = [
    ["a currency conflict", { rpcResult: { outcome: "conflict", reason: "not_current" } }],
    ["a fileability conflict", { rpcResult: { outcome: "conflict", reason: "missing_pdf" } }],
    ["a malformed reply", { rpcResult: null }],
    ["an unknown outcome", { rpcResult: { outcome: "queuedish", job_id: "j" } }],
    ["a database error", { rpcError: { message: "connection reset" } }],
  ];

  for (const [name, scenario] of REFUSALS) {
    it(`does NOT count ${name} as submitted`, async () => {
      const { jobsInsert } = makeSupabase(safeFinal(), scenario);
      const body = await (await GET(req())).json();
      expect(body.enqueuedSubmit).toBe(0);
      expect(body.finalizeRefused).toBe(1);
      expect(jobsInsert).not.toHaveBeenCalled();
    });
  }

  it("refuses when the candidate carries no content revision to pin", async () => {
    const rows = safeFinal();
    delete (rows[0] as Record<string, unknown>).content_revision;
    const { jobsInsert, rpc } = makeSupabase(rows);
    const body = await (await GET(req())).json();
    expect(body.enqueuedSubmit).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
    // CP-C: this refusal moved one step earlier. The selector will not offer a
    // candidate whose inspected content cannot be pinned to what would be
    // filed, so it is counted as "nothing fileable" (and the merchant is now
    // TOLD, which the old `finalizeRefused` path never did) rather than as a
    // transaction the database refused.
    expect(body.finalizeRefused).toBe(0);
    expect(body.enqueuedFallback).toBe(1);
    expect(mockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: "validation_failed" }),
    );
  });
});
