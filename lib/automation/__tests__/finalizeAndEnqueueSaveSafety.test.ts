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

const mockAudit = vi.mocked(logAuditEvent);
const mockMark = vi.mocked(markPackageReviewRequired);

const PKG_ID = "pkg-3";
const DISPUTE_ID = "dispute-1";

// The full 13-key persisted fact shape. PR-C1's parser is schema-aware, so a
// stub fact object is now `unreadable_facts_json` — correctly.
const CLEAN_FACTS = [{
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
  }];
const CLEAN_NARRATIVE = {
  fulfillmentArgument: { text: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1)." },
};
const UNSAFE_NARRATIVE = {
  fulfillmentArgument: { text: "The parcel was delivered to the cardholder's verified address." },
};

function mockSb(named: Record<string, unknown> | null, latestId = PKG_ID) {
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
          if (maybeCalls === 1) return { data: named, error: null };
          if (maybeCalls === 2) return { data: { id: latestId, version: 3 }, error: null };
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

describe("finalizeAndEnqueueSave — PR-C1 preflight", () => {
  it("performs NO mutation and NO enqueue for an unsafe candidate", async () => {
    const { sb, packageUpdate, jobsInsert } = mockSb(
      named({ facts_json: CLEAN_FACTS, narrative_json: UNSAFE_NARRATIVE }),
    );

    const result = await call(sb);

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("affirmative_address_delivery_claim");

    // Nothing finalized, nothing superseded, nothing queued.
    expect(packageUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "defence_package_blocked_unsafe_claim",
        eventPayload: expect.objectContaining({ trigger: "finalize_and_enqueue_save" }),
      }),
    );
    // The merchant gets a review-required attention state, not just a dead job.
    expect(mockMark).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ disputeId: DISPUTE_ID, packageId: PKG_ID }),
    );
  });

  it("performs no side effect for an unreadable candidate", async () => {
    const { sb, packageUpdate, jobsInsert } = mockSb(
      named({ facts_json: null, narrative_json: null }),
    );
    const result = await call(sb);
    expect(result.blocked).toBe(true);
    expect(packageUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("performs no side effect when the named row is not the current candidate", async () => {
    const { sb, packageUpdate, jobsInsert } = mockSb(
      named({ facts_json: CLEAN_FACTS, narrative_json: CLEAN_NARRATIVE }),
      "pkg-4",
    );
    const result = await call(sb);
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("candidate_not_current");
    expect(packageUpdate).not.toHaveBeenCalled();
    expect(jobsInsert).not.toHaveBeenCalled();
  });

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
