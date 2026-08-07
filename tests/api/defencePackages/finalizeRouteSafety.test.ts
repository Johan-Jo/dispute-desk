/**
 * PR-C1 — the Finalize endpoint performs NO status mutation for a candidate
 * that is unsafe, unreadable, missing, non-current, or unverifiable.
 *
 * Finalizing is a real authorization step, not cosmetic: it promotes the draft
 * to `final` AND supersedes the prior final. An unsafe draft reaching this
 * route therefore RETIRES the last good package and leaves the dispute with a
 * newest candidate the worker will refuse — strictly worse than doing nothing.
 *
 * Suppressing the Finalize button is not an authorization boundary: a stale
 * tab, a direct request, a race with a regeneration, or a future UI all reach
 * this handler. These tests drive the real route handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { POST } from "@/app/api/defence-packages/[id]/finalize/route";
import { NextRequest } from "next/server";
import {
  AMBIGUOUS_NARRATIVE,
  CLEAN_NARRATIVE,
  FULL_FACT,
  RETIRED_FACT,
  UNSAFE_NARRATIVE,
  TEST_REVISION,
  mockNamedCandidateClient,
  type NamedCandidateScenario,
} from "./namedCandidateMock";

const mockClient = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);

const PKG_ID = "pkg-3";

const req = () =>
  new NextRequest("https://x.test/api/defence-packages/pkg-3/finalize", { method: "POST" });
const params = { params: Promise.resolve({ id: PKG_ID }) };

/** A draft that passes every PRE-EXISTING finalize gate, so the only thing
 *  that can stop it is the PR-C1 preflight. */
const draft = (over: Record<string, unknown>) => ({
  id: PKG_ID,
  dispute_id: "dispute-1",
  shop_id: "shop-1",
  source_pack_id: "pack-1",
  version: 3,
  status: "draft",
  validation_status: "ok",
  pdf_path: "shop/dispute/v3.pdf",
  ...over,
});

function wire(s: NamedCandidateScenario) {
  const m = mockNamedCandidateClient(s);
  mockClient.mockReturnValue(m.client);
  return m;
}

const finalizedAudit = () =>
  mockAudit.mock.calls.filter(
    (c) => (c[0] as { eventType?: string })?.eventType === "defence_package_finalized",
  );
const supersededAudit = () =>
  mockAudit.mock.calls.filter(
    (c) => (c[0] as { eventType?: string })?.eventType === "defence_package_superseded",
  );
const blockAudit = () =>
  mockAudit.mock.calls.filter(
    (c) => (c[0] as { eventType?: string })?.eventType === "defence_package_blocked_unsafe_claim",
  );

beforeEach(() => vi.clearAllMocks());

describe("POST /api/defence-packages/:id/finalize — PR-C1 preflight", () => {
  const BLOCKING: Array<[string, NamedCandidateScenario, string, number]> = [
    [
      "unsafe narrative",
      { named: draft({ facts_json: [FULL_FACT], narrative_json: UNSAFE_NARRATIVE }) },
      "affirmative_address_delivery_claim",
      422,
    ],
    [
      "ambiguous narrative",
      { named: draft({ facts_json: [FULL_FACT], narrative_json: AMBIGUOUS_NARRATIVE }) },
      "ambiguous_address_delivery_claim",
      422,
    ],
    [
      "retired delivery fact",
      { named: draft({ facts_json: [RETIRED_FACT], narrative_json: CLEAN_NARRATIVE }) },
      "retired_delivery_fact",
      422,
    ],
    [
      "unreadable JSON",
      { named: draft({ facts_json: null, narrative_json: null }) },
      "unreadable_facts_json",
      422,
    ],
    [
      "structurally incomplete fact",
      { named: draft({ facts_json: [{}], narrative_json: CLEAN_NARRATIVE }) },
      "unreadable_facts_json",
      422,
    ],
    [
      "not the current candidate",
      {
        named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
        latestId: "pkg-4",
      },
      "candidate_not_current",
      422,
    ],
    [
      "latest-version probe query error",
      {
        named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
        latestError: { message: "timeout" },
      },
      "preflight_error",
      503,
    ],
  ];

  for (const [name, scenario, reason, status] of BLOCKING) {
    it(`refuses (${name}): no finalize, no supersede, no finalization audit`, async () => {
      const { packageUpdates } = wire(scenario);

      const res = await POST(req(), params);
      const body = await res.json();

      expect(res.status).toBe(status);
      expect(body.reasons).toContain(reason);

      // NOTHING was promoted and NOTHING was superseded.
      expect(packageUpdates).toEqual([]);
      expect(finalizedAudit()).toHaveLength(0);
      expect(supersededAudit()).toHaveLength(0);

      // A safety-block audit IS expected, and is distinct from finalization.
      expect(blockAudit()).toHaveLength(1);
      expect(blockAudit()[0][0]).toMatchObject({
        eventType: "defence_package_blocked_unsafe_claim",
        eventPayload: expect.objectContaining({ trigger: "finalize" }),
      });
    });
  }

  it("an unsafe draft cannot supersede a prior safe final", async () => {
    // The prior final is only ever touched in step 2, which the preflight
    // returns before. Proven by: zero writes to defence_packages at all.
    const { packageUpdates } = wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: UNSAFE_NARRATIVE }),
    });
    await POST(req(), params);
    expect(packageUpdates).toEqual([]);
    expect(supersededAudit()).toHaveLength(0);
  });

  it("refuses and mutates nothing when the route's own package load errors", async () => {
    // Same query as the preflight's named lookup, so a failure short-circuits
    // at the 404 guard. The invariant that matters is unchanged: non-2xx, no
    // write to defence_packages, no finalization audit.
    const { packageUpdates } = wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      namedError: { message: "connection reset" },
    });
    const res = await POST(req(), params);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(packageUpdates).toEqual([]);
    expect(finalizedAudit()).toHaveLength(0);
  });

  it("a transient LATEST-probe failure does not tell the merchant to regenerate", async () => {
    wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      latestError: { message: "timeout" },
    });
    const res = await POST(req(), params);
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe("PACKAGE_CHECK_UNAVAILABLE");
    expect(body.message).not.toMatch(/regenerate/i);
  });

  it("finalizes normally for a safe, current candidate", async () => {
    wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
    });

    const res = await POST(req(), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, packageId: PKG_ID });
    expect(finalizedAudit()).toHaveLength(1);
    expect(blockAudit()).toHaveLength(0);
  });

  /* ── The guarded transition ──────────────────────────────────────────
   *
   * The read and the write are separate round-trips. The update used to be
   * `.eq("id", id)` alone, so a lifecycle another actor changed in between —
   * a regeneration flipping the row to `stale`, the auto path finalizing it,
   * the worker marking it `submitted` — was silently overwritten.
   * ----------------------------------------------------------------- */

  it("a transactional CONFLICT returns 409 and writes no finalization audit", async () => {
    // The RPC refused (a newer version landed, the content changed, the row
    // was no longer a draft…). Nothing was written, so nothing downstream may
    // claim success.
    wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      rpcResult: { outcome: "conflict", reason: "not_current" },
    });

    const res = await POST(req(), params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("PACKAGE_LIFECYCLE_CONFLICT");
    expect(body.reason).toBe("not_current");
    expect(finalizedAudit()).toHaveLength(0);
    expect(supersededAudit()).toHaveLength(0);
  });

  it("an RPC transport failure is a 500, not a silent success", async () => {
    wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      rpcError: { message: "connection reset" },
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(500);
    expect(finalizedAudit()).toHaveLength(0);
  });

  it("the route performs NO direct status write — promotion belongs to the transaction", async () => {
    // A pre-read plus a later PostgREST update cannot be atomic however many
    // predicates it repeats. The behavioural proof of the transaction itself
    // (currency under lock, content revision, rollback, concurrency) lives in
    // `scripts/db/finalizeDefencePackage.analysis.ts`, against a real database.
    const { packageUpdates, rpc } = wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
    });
    await POST(req(), params);
    expect(packageUpdates).toEqual([]);
    expect(rpc).toHaveBeenCalledWith(
      "finalize_defence_package",
      expect.objectContaining({
        p_package_id: PKG_ID,
        p_expected_revision: TEST_REVISION,
        p_enqueue_save: false,
      }),
    );
  });

  it("supersession is audited from the transaction's own report", async () => {
    wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      rpcResult: { outcome: "promoted", package_id: PKG_ID, superseded_id: "pkg-old", superseded_version: 2 },
    });
    await POST(req(), params);
    expect(supersededAudit()).toHaveLength(1);
    expect(supersededAudit()[0][0]).toMatchObject({
      eventPayload: expect.objectContaining({ supersededId: "pkg-old" }),
    });
  });

  it("an idempotent replay writes no SECOND finalization audit", async () => {
    wire({
      named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      rpcResult: { outcome: "already_done", package_id: PKG_ID, reason: "already_promoted" },
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(finalizedAudit()).toHaveLength(0);
  });

  it("pre-existing gates still fire before the preflight is even reached", async () => {
    // `submitted` (and every other non-draft, non-final status) is still a
    // hard refusal.
    wire({ named: draft({ status: "submitted", facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }) });
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect(blockAudit()).toHaveLength(0);
  });

  it("an already-FINAL candidate is an idempotent success that enqueues nothing", async () => {
    // A merchant double-click, or a retried request. Returning an error for
    // work that is already done reads as a failure the merchant must fix; the
    // route must never reach the save from this path either.
    const { jobsInsert, rpc, packageUpdates } = wire({
      named: draft({ status: "final", facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
    });
    const res = await POST(req(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, idempotent: true });
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(packageUpdates).toEqual([]);
    expect(finalizedAudit()).toHaveLength(0);
  });

  it("a malformed RPC reply is 503 UNAVAILABLE, never a 200", async () => {
    for (const rpcResult of [null, [], {}, { outcome: "promotedd", package_id: PKG_ID }]) {
      vi.clearAllMocks();
      wire({
        named: draft({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
        rpcResult: rpcResult as Record<string, unknown>,
      });
      const res = await POST(req(), params);
      expect(res.status, JSON.stringify(rpcResult)).toBe(503);
      expect((await res.json()).code).toBe("PACKAGE_CHECK_UNAVAILABLE");
      expect(finalizedAudit()).toHaveLength(0);
      expect(supersededAudit()).toHaveLength(0);
    }
  });
});
