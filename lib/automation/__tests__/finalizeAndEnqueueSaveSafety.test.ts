/**
 * PR-C1 — `finalizeAndEnqueueSave` refuses an unsafe candidate before ANY
 * side effect, and `reconcileParkedAutoDisputes` reports the refusal instead
 * of counting it as reconciled.
 *
 * Ordering is the whole point. Assessing after the finalize would leave an
 * unsafe row promoted to `final`, the previous good row superseded by it, and
 * only the worker refusing to file — a dispute whose newest candidate is
 * final-but-unfileable and whose fallback has been retired.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../packageReviewRequired", () => ({
  markPackageReviewRequired: vi.fn().mockResolvedValue(undefined),
}));

import { logAuditEvent } from "@/lib/audit/logEvent";
import { markPackageReviewRequired } from "../packageReviewRequired";
import { finalizeAndEnqueueSave } from "../finalizeAndEnqueueSave";
import {
  CLEAN_FACTS,
  CLEAN_NARRATIVE,
  UNSAFE_NARRATIVE,
} from "@/tests/fixtures/defencePackageShapes";

const mockAudit = vi.mocked(logAuditEvent);
const mockMark = vi.mocked(markPackageReviewRequired);

const PKG_ID = "pkg-3";

const finalizedAudits = () =>
  mockAudit.mock.calls.filter(
    (c) => (c[0] as { eventType?: string })?.eventType === "defence_package_finalized",
  );
const supersededAudits = () =>
  mockAudit.mock.calls.filter(
    (c) => (c[0] as { eventType?: string })?.eventType === "defence_package_superseded",
  );
const DISPUTE_ID = "dispute-1";



interface SbScenario {
  latestId?: string | null;
  namedError?: { message: string } | null;
  latestError?: { message: string } | null;
  /**
   * Rows the guarded draft-to-final UPDATE reports as affected. Defaults to
   * ONE — this caller won the transition. `[]` simulates a concurrent
   * lifecycle change between the preflight and the write.
   *
   * The previous fixture returned `[]` on the happy path and still expected an
   * enqueue, which is exactly the fail-open the helper had: an empty update
   * was being read as success.
   */
  /** What `finalize_defence_package` returns. Defaults to a promotion. */
  rpcResult?: unknown;
  /** Make the RPC call itself fail (a transport/database error). */
  rpcError?: { message: string } | null;
  /** The durable `dpkg-finalize:<id>` job row, i.e. proof that an earlier
   *  auto transaction committed. */
  marker?: { id: string } | null;
  markerError?: { message: string } | null;
}

function mockSb(named: Record<string, unknown> | null, scenario: SbScenario = {}) {
  const latestId = scenario.latestId === undefined ? PKG_ID : scenario.latestId;
  const rpc = vi.fn(async () =>
    scenario.rpcError
      ? { data: null, error: scenario.rpcError }
      : {
          data:
            "rpcResult" in scenario
              ? scenario.rpcResult
              : { outcome: "promoted", package_id: PKG_ID, job_id: "job-1" },
          error: null,
        },
  );
  // Any direct write to defence_packages is now a defect: promotion,
  // supersession and the enqueue all live in the transaction.
  const chain: Record<string, unknown> = {};
  for (const k of ["eq", "neq", "not", "select"]) chain[k] = vi.fn(() => chain);
  (chain as { then?: unknown }).then = (cb: (v: unknown) => unknown) =>
    cb({ data: [], error: null });
  const packageUpdate = vi.fn((_values: Record<string, unknown>) => chain);
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  let maybeCalls = 0;
  const from = vi.fn((table: string) => {
    if (table === "defence_packages") {
      const q: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        update: packageUpdate,
        maybeSingle: vi.fn().mockImplementation(async () => {
          maybeCalls += 1;
          // 1st = named row, 2nd = latest-version probe, later = prior-final.
          if (maybeCalls === 1) {
            return scenario.namedError
              ? { data: null, error: scenario.namedError }
              : { data: named, error: null };
          }
          if (maybeCalls === 2) {
            if (scenario.latestError) return { data: null, error: scenario.latestError };
            return { data: latestId ? { id: latestId, version: 3 } : null, error: null };
          }
          return { data: null, error: null };
        }),
      };
      return q;
    }
    if (table === "jobs") {
      // `insert` for the legacy path (which must never be used any more), and
      // `select` for the commit-marker lookup.
      const q: Record<string, unknown> = {
        insert: jobsInsert,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockImplementation(async () =>
          scenario.markerError
            ? { data: null, error: scenario.markerError }
            : { data: scenario.marker ?? null, error: null },
        ),
      };
      return q;
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { sb: { from, rpc } as never, packageUpdate, jobsInsert, rpc };
}

const TEST_REVISION = "11111111-1111-4111-8111-111111111111";

const named = (over: Record<string, unknown>) => ({
  id: PKG_ID,
  version: 3,
  content_revision: TEST_REVISION,
  status: "draft",
  ...over,
});

const call = (sb: never) =>
  finalizeAndEnqueueSave({
    sb,
    shopId: "shop-1",
    disputeId: DISPUTE_ID,
    packageId: PKG_ID,
    packageVersion: 3,
    sourcePackId: "pack-1",
  });

beforeEach(() => vi.clearAllMocks());

describe("finalizeAndEnqueueSave — content blocks", () => {
  it("performs NO mutation and NO enqueue for an unsafe candidate", async () => {
    const { sb, packageUpdate, jobsInsert } = mockSb(
      named({ facts_json: CLEAN_FACTS, narrative_json: UNSAFE_NARRATIVE }),
    );

    const result = await call(sb);

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("content_block");
    expect(result.blocked).toBe(true);
    expect(result.retriable).toBe(false);
    expect(result.reason).toContain("affirmative_address_delivery_claim");

    // Nothing finalized, nothing superseded, nothing queued.
    expect(packageUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "defence_package_blocked_unsafe_claim",
        eventPayload: expect.objectContaining({
          trigger: "finalize_and_enqueue_save",
          contentBlock: true,
        }),
      }),
    );
    // The merchant gets a review-required attention state, not just a dead job.
    expect(mockMark).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disputeId: DISPUTE_ID, packageId: PKG_ID }),
    );
  });

  it("performs no side effect for an unreadable candidate — also a content block", async () => {
    const { sb, packageUpdate, jobsInsert } = mockSb(
      named({ facts_json: null, narrative_json: null }),
    );
    const result = await call(sb);
    expect(result.failure).toBe("content_block");
    expect(result.blocked).toBe(true);
    expect(packageUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(mockMark).toHaveBeenCalled();
  });
});

/* ── Outcome classification ───────────────────────────────────────────────
 *
 * The first revision called `markPackageReviewRequired` and returned
 * `blocked: true` for EVERY non-safe outcome, so a Supabase timeout or a
 * not-yet-built package raised a merchant-facing "regenerate this package"
 * banner and was counted by the reconcile pass as a safety block.
 * ---------------------------------------------------------------------- */

describe("finalizeAndEnqueueSave — non-content outcomes never park for review", () => {
  const NON_CONTENT: Array<[string, SbScenario, string, boolean]> = [
    ["a query error on the named lookup", { namedError: { message: "timeout" } }, "transient", true],
    ["a query error on the latest probe", { latestError: { message: "timeout" } }, "transient", true],
    ["no candidate at all", { latestId: null }, "pending", true],
  ];

  for (const [name, scenario, failure, retriable] of NON_CONTENT) {
    it(`${name} → ${failure}, retriable=${retriable}, NO banner`, async () => {
      const { sb, packageUpdate, jobsInsert } = mockSb(
        scenario.latestId === null
          ? null
          : named({ facts_json: CLEAN_FACTS, narrative_json: CLEAN_NARRATIVE }),
        scenario,
      );
      const result = await call(sb);

      expect(result.ok).toBe(false);
      expect(result.failure).toBe(failure);
      expect(result.blocked).toBe(false);
      expect(result.retriable).toBe(retriable);

      // No mutation, no job — and crucially, no merchant review banner.
      expect(packageUpdate).not.toHaveBeenCalled();
      expect(jobsInsert).not.toHaveBeenCalled();
      expect(mockMark).not.toHaveBeenCalled();

      // The refusal is still audited, and marked as NOT a content verdict.
      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "defence_package_blocked_unsafe_claim",
          eventPayload: expect.objectContaining({ contentBlock: false }),
        }),
      );
    });
  }

  it("a non-current named row is `stale`: no mutation, no banner, no retry", async () => {
    const { sb, packageUpdate, jobsInsert } = mockSb(
      named({ facts_json: CLEAN_FACTS, narrative_json: CLEAN_NARRATIVE }),
      { latestId: "pkg-4" },
    );
    const result = await call(sb);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("stale");
    expect(result.blocked).toBe(false);
    expect(result.retriable).toBe(false);
    expect(result.reason).toContain("candidate_not_current");
    expect(packageUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();
  });
});

/* ── The guarded lifecycle transition ─────────────────────────────────────
 *
 * Winning the draft-to-final UPDATE is the AUTHORIZATION to supersede and
 * enqueue. The previous revision guarded only on status='draft' and treated an
 * empty result as success — so an already-final row "fell through" to a second
 * supersede and a second save job, performed by a caller that had finalized
 * nothing.
 * --------------------------------------------------------------------- */

describe("finalizeAndEnqueueSave — the transactional promotion", () => {
  const eligibleDraft = () =>
    named({
      status: "draft",
      validation_status: "ok",
      pdf_path: "shop/dispute/v3.pdf",
      facts_json: CLEAN_FACTS,
      narrative_json: CLEAN_NARRATIVE,
    });

  it("delegates to the transaction and audits only what it committed", async () => {
    const { sb, packageUpdate, jobsInsert, rpc } = mockSb(eligibleDraft(), {
      rpcResult: {
        outcome: "promoted",
        package_id: PKG_ID,
        superseded_id: "pkg-old",
        superseded_version: 2,
        job_id: "job-1",
      },
    });
    const result = await call(sb);

    expect(result.ok).toBe(true);
    // Promotion, supersession and the enqueue are ONE transaction — the helper
    // must not write any of them itself.
    expect(packageUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "finalize_defence_package",
      expect.objectContaining({
        p_package_id: PKG_ID,
        p_expected_revision: TEST_REVISION,
        p_expected_version: 3,
        p_enqueue_save: true,
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "defence_package_finalized" }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "defence_package_superseded" }),
    );
  });

  it("a transactional CONFLICT audits no finalization and is not retriable", async () => {
    const { sb, jobsInsert } = mockSb(eligibleDraft(), {
      rpcResult: { outcome: "conflict", reason: "not_current" },
    });
    const result = await call(sb);

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("lifecycle");
    expect(result.blocked).toBe(false);
    expect(result.retriable).toBe(false);
    expect(result.reason).toContain("not_current");
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(finalizedAudits()).toHaveLength(0);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("an RPC transport error stays transient and retriable", async () => {
    const { sb, jobsInsert } = mockSb(eligibleDraft(), {
      rpcError: { message: "deadlock detected" },
    });
    const result = await call(sb);
    expect(result.failure).toBe("transient");
    expect(result.retriable).toBe(true);
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("refuses when the candidate carries NO content revision to pin", async () => {
    const draft = eligibleDraft() as Record<string, unknown>;
    delete draft.content_revision;
    const { sb, rpc } = mockSb(draft);
    const result = await call(sb);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("lifecycle");
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* ── Malformed RPC replies are UNKNOWNS, never successes ──────────────────
 *
 * The previous revision read the reply as `(data ?? {}) as {outcome?: string}`
 * and treated everything that was not `conflict` / `already_done` as a
 * promotion — so `null`, `[]`, `{}`, a typo and a success that could not name
 * its job all produced finalization and supersession audits for work the
 * database may never have done.
 * --------------------------------------------------------------------- */

describe("finalizeAndEnqueueSave — malformed RPC replies", () => {
  const eligibleDraft = () =>
    named({
      status: "draft",
      validation_status: "ok",
      pdf_path: "shop/dispute/v3.pdf",
      facts_json: CLEAN_FACTS,
      narrative_json: CLEAN_NARRATIVE,
    });

  const MALFORMED: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["an array", [{ outcome: "promoted" }]],
    ["an empty object", {}],
    ["a string", "promoted"],
    ["a misspelled outcome", { outcome: "promotedd", package_id: PKG_ID, job_id: "j" }],
    ["a promotion with no package_id", { outcome: "promoted", job_id: "j" }],
    ["a promotion that cannot name its job", { outcome: "promoted", package_id: PKG_ID }],
    ["an already_done that cannot name its job", { outcome: "already_done", package_id: PKG_ID }],
    ["a conflict with no reason", { outcome: "conflict" }],
  ];

  for (const [label, rpcResult] of MALFORMED) {
    it(`treats ${label} as unavailable, not success`, async () => {
      const { sb, jobsInsert } = mockSb(eligibleDraft(), { rpcResult });
      const result = await call(sb);

      expect(result.ok).toBe(false);
      expect(result.failure).toBe("transient");
      expect(result.retriable).toBe(true);
      expect(jobsInsert).not.toHaveBeenCalled();
      // The point: no audit claims work that was never proven.
      expect(finalizedAudits()).toHaveLength(0);
      expect(supersededAudits()).toHaveLength(0);
    });
  }
});

/* ── Lost-response replay, reachable through the real caller ──────────────
 *
 * The RPC's own replay branch was already correct, but the application made
 * it unreachable: `requireFinalizable` rejected an already-final candidate
 * before `.rpc(...)` was ever called, so a committed auto-finalization whose
 * reply was lost came back as a non-retriable failure.
 * --------------------------------------------------------------------- */

describe("finalizeAndEnqueueSave — lost-response replay", () => {
  const promoted = (over: Record<string, unknown> = {}) =>
    named({
      status: "final",
      validation_status: "ok",
      pdf_path: "shop/dispute/v3.pdf",
      facts_json: CLEAN_FACTS,
      narrative_json: CLEAN_NARRATIVE,
      ...over,
    });

  it("converges on success when the durable commit marker exists", async () => {
    const { sb, rpc, jobsInsert } = mockSb(promoted(), { marker: { id: "job-1" } });
    const result = await call(sb);

    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(true);
    // Nothing done a second time: no RPC, no job, no audit.
    expect(rpc).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(finalizedAudits()).toHaveLength(0);
  });

  it("also converges for a candidate already SUBMITTED", async () => {
    const { sb } = mockSb(promoted({ status: "submitted" }), { marker: { id: "job-1" } });
    const result = await call(sb);
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(true);
  });

  it("does NOT adopt a final package that has no commit marker", async () => {
    // A merchant may have approved it by hand, or an older path promoted it.
    // Either way this caller did not commit it and must not claim it did.
    const { sb, rpc } = mockSb(promoted(), { marker: null });
    const result = await call(sb);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("lifecycle");
    expect(result.reason).toContain("without_commit_marker");
    expect(rpc).not.toHaveBeenCalled();
    expect(finalizedAudits()).toHaveLength(0);
  });

  it("a marker lookup failure is transient, not a lifecycle verdict", async () => {
    const { sb } = mockSb(promoted(), { markerError: { message: "timeout" } });
    const result = await call(sb);
    expect(result.failure).toBe("transient");
    expect(result.retriable).toBe(true);
  });

  it("a STALE final (a newer version exists) is refused before the marker matters", async () => {
    const { sb, rpc } = mockSb(promoted(), { latestId: "pkg-9", marker: { id: "job-1" } });
    const result = await call(sb);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("stale");
    expect(rpc).not.toHaveBeenCalled();
  });
});
