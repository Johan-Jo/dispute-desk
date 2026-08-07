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
const DISPUTE_ID = "dispute-1";



interface SbScenario {
  latestId?: string | null;
  namedError?: { message: string } | null;
  latestError?: { message: string } | null;
}

function mockSb(named: Record<string, unknown> | null, scenario: SbScenario = {}) {
  const latestId = scenario.latestId === undefined ? PKG_ID : scenario.latestId;
  const packageUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  });
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
    if (table === "jobs") return { insert: jobsInsert };
    throw new Error(`unexpected table: ${table}`);
  });
  return { sb: { from } as never, packageUpdate, jobsInsert };
}

const named = (over: Record<string, unknown>) => ({
  id: PKG_ID,
  version: 3,
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

describe("finalizeAndEnqueueSave — the safe path is untouched", () => {
  it("finalizes and enqueues normally for a safe, current candidate", async () => {
    const { sb, packageUpdate, jobsInsert } = mockSb(
      named({ facts_json: CLEAN_FACTS, narrative_json: CLEAN_NARRATIVE }),
    );
    const result = await call(sb);
    expect(result.ok).toBe(true);
    expect(packageUpdate).toHaveBeenCalled();
    expect(jobsInsert).toHaveBeenCalledTimes(1);
    expect(mockMark).not.toHaveBeenCalled();
  });
});
