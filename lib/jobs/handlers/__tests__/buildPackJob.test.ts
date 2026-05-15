/**
 * Tests for `handleBuildPack` (Phase 4.2).
 *
 * The handler orchestrates buildPack + audit + dispute events + auto-save
 * evaluation + the manual-evidence email. Each downstream call is mocked
 * so the tests stay fast and exercise only the orchestration logic:
 *   - happy path → status=building → buildPack ok → pack_created event +
 *     auto-save evaluator runs.
 *   - failed-status path → buildPack returns status=failed → emits
 *     PACK_BUILD_FAILED but does NOT throw, and skips auto-save / email.
 *   - thrown-error path → buildPack throws → status flipped to "failed",
 *     PACK_BUILD_FAILED emitted, error rethrown so the worker can mark
 *     the job failed, and the deferred new-dispute alert fires (review
 *     variant).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/packs/buildPack", () => ({
  buildPack: vi.fn(),
}));
vi.mock("@/lib/automation/pipeline", () => ({
  evaluateAndMaybeAutoSave: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendEvidenceNeededAlert", () => ({
  sendEvidenceNeededAlert: vi.fn().mockResolvedValue({ ok: false }),
  shouldSendEvidenceAlert: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/email/sendNewDisputeAlert", () => ({
  claimAndSendDeferredNewDisputeAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({
  emitDisputeEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/disputeEvents/updateNormalizedStatus", () => ({
  updateNormalizedStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/billing/consumePack", () => ({
  consumePack: vi.fn(),
  PackLimitReachedError: class extends Error {
    code = "PACK_LIMIT_REACHED";
    remaining: number;
    shopId: string;
    constructor(shopId = "shop-1", remaining = 0) {
      super("Pack limit reached.");
      this.shopId = shopId;
      this.remaining = remaining;
    }
  },
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { buildPack } from "@/lib/packs/buildPack";
import { evaluateAndMaybeAutoSave } from "@/lib/automation/pipeline";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { claimAndSendDeferredNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { consumePack, PackLimitReachedError } from "@/lib/billing/consumePack";
import { handleBuildPack } from "../buildPackJob";
import type { ClaimedJob } from "../../claimJobs";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockBuildPack = vi.mocked(buildPack);
const mockEvaluateAndMaybeAutoSave = vi.mocked(evaluateAndMaybeAutoSave);
const mockEmitDisputeEvent = vi.mocked(emitDisputeEvent);
const mockDeferredAlert = vi.mocked(claimAndSendDeferredNewDisputeAlert);
const mockConsumePack = vi.mocked(consumePack);

const PACK_ID = "pack-1";
const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";

function makeJob(): ClaimedJob {
  return {
    id: "job-1",
    shopId: SHOP_ID,
    jobType: "build_pack",
    entityId: PACK_ID,
    attempts: 0,
    maxAttempts: 3,
  };
}

/** Minimal Supabase double — `evidence_packs.update().eq()` chain plus
 *  `.select(...).single()` for dispute_id lookup. Returns the dispute
 *  id provided. Tracks calls to update() so tests can assert status
 *  transitions. */
function makeSb(opts: { disputeId?: string | null } = {}) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const update = vi.fn((patch: Record<string, unknown>) => {
    updateCalls.push(patch);
    return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
  });
  const single = vi.fn().mockResolvedValue({
    data: { dispute_id: opts.disputeId === undefined ? DISPUTE_ID : opts.disputeId },
    error: null,
  });
  const sb = {
    from: vi.fn(() => ({
      update,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single }),
      }),
    })),
  };
  return { sb, updateCalls };
}

describe("handleBuildPack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsumePack.mockResolvedValue({ ok: true, consumed: 1, remaining: 4 });
  });

  it("happy path: marks pack 'building', runs buildPack, emits PACK_CREATED, and triggers auto-save", async () => {
    const { sb, updateCalls } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockBuildPack.mockResolvedValue({
      packId: PACK_ID,
      status: "ready",
      completenessScore: 90,
      blockers: [],
      sectionsCollected: 6,
      itemsCreated: 9,
      failureCode: null,
    });

    await handleBuildPack(makeJob());

    // Status transition: building (set first thing).
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({ status: "building" }),
    );

    // buildPack got the pack id + correlationId from the job.
    expect(mockBuildPack).toHaveBeenCalledWith(PACK_ID, {
      correlationId: "job-1",
    });

    // Audit event written for pack_created (not job_failed).
    const auditTypes = mockLogAuditEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditTypes).toContain("pack_created");
    expect(auditTypes).not.toContain("job_failed");

    // PACK_CREATED dispute event fired (the merchant timeline path).
    const eventTypes = mockEmitDisputeEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("pack_created");

    // Auto-save evaluator ran (it's the gate for auto-mode submission).
    expect(mockEvaluateAndMaybeAutoSave).toHaveBeenCalledWith(PACK_ID);

    // Failed-state cleanup did NOT run.
    expect(mockDeferredAlert).not.toHaveBeenCalled();
  });

  it("buildPack returned status=failed: emits PACK_BUILD_FAILED and skips auto-save", async () => {
    const { sb } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockBuildPack.mockResolvedValue({
      packId: PACK_ID,
      status: "failed",
      completenessScore: 0,
      blockers: [],
      sectionsCollected: 0,
      itemsCreated: 0,
      failureCode: "order_fetch_failed",
    });

    await handleBuildPack(makeJob());

    // Audit reflects job_failed (not pack_created).
    const auditTypes = mockLogAuditEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditTypes).toContain("job_failed");
    expect(auditTypes).not.toContain("pack_created");

    // Dispute event reflects build failure (not pack created).
    const eventTypes = mockEmitDisputeEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("pack_build_failed");
    expect(eventTypes).not.toContain("pack_created");

    // Auto-save gate must NOT run on a failed build (PRD invariant —
    // there is no merchant-actionable evidence path here).
    expect(mockEvaluateAndMaybeAutoSave).not.toHaveBeenCalled();

    // Deferred new-dispute email does NOT fire from buildPackJob's
    // failed branch — the merchant will receive it via the next
    // rebuild attempt's success path. Failed builds intentionally
    // suppress the email to avoid notifying merchants about a system
    // error that has no merchant action.
    expect(mockDeferredAlert).not.toHaveBeenCalled();
  });

  it("buildPack threw: flips status to failed, fires deferred review alert, and rethrows", async () => {
    const { sb, updateCalls } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    const upstream = new Error("buildPack exploded");
    mockBuildPack.mockRejectedValue(upstream);

    await expect(handleBuildPack(makeJob())).rejects.toThrow(
      "buildPack exploded",
    );

    // First update: status → building (entry); second: status → failed (catch).
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({ status: "building" }),
    );
    expect(updateCalls.at(-1)).toEqual(
      expect.objectContaining({ status: "failed" }),
    );

    // Deferred alert fires the review variant so the merchant still
    // hears about the new dispute even though the build failed at the
    // system level (idempotent via new_dispute_alert_sent_at).
    expect(mockDeferredAlert).toHaveBeenCalledWith(DISPUTE_ID, "review");

    // Audit + dispute event document the failure.
    const auditTypes = mockLogAuditEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditTypes).toContain("job_failed");
    const eventTypes = mockEmitDisputeEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("pack_build_failed");
  });

  it("throws when entity_id is missing (no pack to build against)", async () => {
    mockGetServiceClient.mockReturnValue({} as unknown as ReturnType<typeof getServiceClient>);
    await expect(
      handleBuildPack({ ...makeJob(), entityId: null }),
    ).rejects.toThrow(/missing entity_id/);
    // buildPack should never be called when the entity is missing.
    expect(mockBuildPack).not.toHaveBeenCalled();
  });

  it("happy build calls consumePack with finalize event and emits credit-consumed audit", async () => {
    const { sb } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockBuildPack.mockResolvedValue({
      packId: PACK_ID,
      status: "ready",
      completenessScore: 90,
      blockers: [],
      sectionsCollected: 6,
      itemsCreated: 9,
      failureCode: null,
    });

    await handleBuildPack(makeJob());

    expect(mockConsumePack).toHaveBeenCalledWith({
      shopId: SHOP_ID,
      disputeId: DISPUTE_ID,
      packId: PACK_ID,
      eventType: "finalize",
    });
    const auditTypes = mockLogAuditEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditTypes).toContain("pack_credit_consumed");
    // Auto-save still runs after a successful credit consume.
    expect(mockEvaluateAndMaybeAutoSave).toHaveBeenCalledWith(PACK_ID);
  });

  it("PackLimitReachedError flips pack to failed, emits failure event, and skips auto-save", async () => {
    const { sb, updateCalls } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockBuildPack.mockResolvedValue({
      packId: PACK_ID,
      status: "ready",
      completenessScore: 90,
      blockers: [],
      sectionsCollected: 6,
      itemsCreated: 9,
      failureCode: null,
    });
    mockConsumePack.mockRejectedValue(new PackLimitReachedError(SHOP_ID, 0));

    await handleBuildPack(makeJob());

    // Status flipped to failed after the consume race.
    expect(updateCalls.at(-1)).toEqual(
      expect.objectContaining({ status: "failed" }),
    );
    const auditTypes = mockLogAuditEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(auditTypes).toContain("pack_limit_reached_at_consume");
    const eventTypes = mockEmitDisputeEvent.mock.calls.map(
      (c) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain("pack_build_failed");
    // Auto-save MUST NOT run when credit consumption fails — the pack
    // is in a failed state and there's no merchant-actionable evidence.
    expect(mockEvaluateAndMaybeAutoSave).not.toHaveBeenCalled();
  });

  it("unknown consumePack error: logs but continues to auto-save (don't break success on billing fluke)", async () => {
    const { sb } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockBuildPack.mockResolvedValue({
      packId: PACK_ID,
      status: "ready",
      completenessScore: 90,
      blockers: [],
      sectionsCollected: 6,
      itemsCreated: 9,
      failureCode: null,
    });
    mockConsumePack.mockRejectedValue(new Error("ledger temporarily down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await handleBuildPack(makeJob());

    expect(mockEvaluateAndMaybeAutoSave).toHaveBeenCalledWith(PACK_ID);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("failed build does NOT call consumePack (failed builds must not consume credit)", async () => {
    const { sb } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockBuildPack.mockResolvedValue({
      packId: PACK_ID,
      status: "failed",
      completenessScore: 0,
      blockers: [],
      sectionsCollected: 0,
      itemsCreated: 0,
      failureCode: "order_fetch_failed",
    });

    await handleBuildPack(makeJob());

    expect(mockConsumePack).not.toHaveBeenCalled();
  });

  it("thrown buildPack does NOT call consumePack", async () => {
    const { sb } = makeSb();
    mockGetServiceClient.mockReturnValue(sb as unknown as ReturnType<typeof getServiceClient>);
    mockBuildPack.mockRejectedValue(new Error("buildPack exploded"));

    await expect(handleBuildPack(makeJob())).rejects.toThrow();
    expect(mockConsumePack).not.toHaveBeenCalled();
  });
});
