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
// Use the REAL shouldSendEvidenceAlert (pure gate) so the alert path is
// actually exercised; only sendEvidenceNeededAlert is stubbed so tests can
// assert the context it receives (presentFields, orderName, …).
vi.mock("@/lib/email/sendEvidenceNeededAlert", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/email/sendEvidenceNeededAlert")
  >("@/lib/email/sendEvidenceNeededAlert");
  return {
    ...actual,
    sendEvidenceNeededAlert: vi.fn().mockResolvedValue({ ok: false }),
  };
});
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
import { sendEvidenceNeededAlert } from "@/lib/email/sendEvidenceNeededAlert";
import { consumePack, PackLimitReachedError } from "@/lib/billing/consumePack";
import { handleBuildPack } from "../buildPackJob";
import type { ClaimedJob } from "../../claimJobs";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockBuildPack = vi.mocked(buildPack);
const mockEvaluateAndMaybeAutoSave = vi.mocked(evaluateAndMaybeAutoSave);
const mockEmitDisputeEvent = vi.mocked(emitDisputeEvent);
const mockDeferredAlert = vi.mocked(claimAndSendDeferredNewDisputeAlert);
const mockSendEvidenceNeededAlert = vi.mocked(sendEvidenceNeededAlert);
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
      priorStrength: null,
      newStrength: "moderate",
      strengthImproved: false,
    });

    await handleBuildPack(makeJob());

    // Status transition: building (set first thing) AND rebuild_pending
    // cleared atomically. Both signals together let the UI keep its
    // "Regenerating" banner continuous from request → pickup → save
    // without flicker (Resubmission Window §5a).
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        status: "building",
        rebuild_pending: false,
      }),
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
      priorStrength: null,
      newStrength: null,
      strengthImproved: false,
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

    // Deferred new-dispute email DOES fire from buildPackJob's failed
    // branch (review variant). The dispatcher deferred this email at
    // sync-time because the pipeline enqueued a build; when the build
    // resolves as failed, the merchant still needs to know a dispute
    // came in — otherwise they get total silence (which is what
    // happened to order #1080 on 2026-05-20 before this fix).
    expect(mockDeferredAlert).toHaveBeenCalledWith("dispute-1", "review");
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
      priorStrength: null,
      newStrength: "moderate",
      strengthImproved: false,
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
      priorStrength: null,
      newStrength: "moderate",
      strengthImproved: false,
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
      priorStrength: null,
      newStrength: "moderate",
      strengthImproved: false,
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
      priorStrength: null,
      newStrength: null,
      strengthImproved: false,
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

/**
 * Table-routing Supabase double for the sendManualEvidenceAlert path. Serves
 * per-table fixtures so we can exercise the content-verified email selection
 * end-to-end. `packSections` populates `pack_json.sections`, which the caller
 * inspects (by content) to decide what real evidence exists.
 */
function makeRoutingSb(opts: {
  packSections?: Array<Record<string, unknown>>;
  disputeRow?: Record<string, unknown>;
  storeProfile?: Record<string, unknown>;
  team?: Record<string, unknown>;
  shopDomain?: string;
}) {
  const rowByTable: Record<string, unknown> = {
    evidence_packs: {
      id: PACK_ID,
      dispute_id: DISPUTE_ID,
      shop_id: SHOP_ID,
      pack_json: { sections: opts.packSections ?? [] },
    },
    disputes: {
      id: DISPUTE_ID,
      reason: "FRAUDULENT",
      amount: 255.07,
      currency_code: "USD",
      evidence_alert_sent_at: null,
      order_name: null,
      ...opts.disputeRow,
    },
    shop_setup: {
      steps: {
        store_profile: {
          payload: opts.storeProfile ?? { storeTypes: ["physical"] },
        },
        team: {
          payload: opts.team ?? { teamEmail: "merchant@example.com" },
        },
      },
    },
    shops: { shop_domain: opts.shopDomain ?? "blume-box.myshopify.com" },
  };

  const sb = {
    from: vi.fn((table: string) => ({
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi
            .fn()
            .mockResolvedValue({ data: rowByTable[table] ?? null, error: null }),
        }),
      }),
    })),
  };
  return { sb };
}

const READY_BUILD = {
  packId: PACK_ID,
  status: "ready" as const,
  completenessScore: 90,
  blockers: [] as string[],
  sectionsCollected: 6,
  itemsCreated: 9,
  failureCode: null,
  priorStrength: null,
  newStrength: "moderate" as const,
  strengthImproved: false,
};

// Real delivery-proof section (delivered_confirmed → moderate/strong).
const realDeliverySection = {
  type: "shipping",
  source: "shopify_fulfillments",
  fieldsProvided: ["shipping_tracking", "delivery_proof"],
  data: { proofType: "delivered_confirmed", deliveredAt: "2026-07-13T17:50:00Z" },
};

// Empty Shopify-timeline comms section — the blume-box false positive: only
// buyer attributes + system events, no real human authorship.
const emptyTimelineComms = {
  type: "comms",
  source: "shopify_timeline",
  fieldsProvided: ["customer_communication"],
  data: {
    summary: {
      staffNotePresent: false,
      customerNotePresent: false,
      merchantCommentCount: 0,
      buyerAttributeCount: 3,
      timelineEventCount: 17,
      confirmationEventCount: 2,
    },
  },
};

// Real Gorgias comms section with approved messages.
const realGorgiasComms = {
  type: "comms",
  source: "gorgias",
  fieldsProvided: ["customer_communication"],
  data: { provider: "gorgias", enriched: true, summary: { messageCount: 4 } },
};

describe("handleBuildPack → sendManualEvidenceAlert (content-verified email)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsumePack.mockResolvedValue({ ok: true, consumed: 1, remaining: 4 });
    mockBuildPack.mockResolvedValue(READY_BUILD);
  });

  it("the blume-box case: real delivery + EMPTY timeline comms → delivery attached, comms NOT claimed", async () => {
    const { sb } = makeRoutingSb({
      packSections: [realDeliverySection, emptyTimelineComms],
    });
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await handleBuildPack(makeJob());

    expect(mockSendEvidenceNeededAlert).toHaveBeenCalledTimes(1);
    const ctx = mockSendEvidenceNeededAlert.mock.calls[0][0];
    expect(ctx.hasRealDeliveryProof).toBe(true);
    // The whole point: an empty timeline (buyer attrs + system events) must NOT
    // be treated as real support conversations.
    expect(ctx.hasRealSupportComms).toBe(false);
  });

  it("real Gorgias comms with messages → hasRealSupportComms true", async () => {
    const { sb } = makeRoutingSb({
      packSections: [realDeliverySection, realGorgiasComms],
    });
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await handleBuildPack(makeJob());

    const ctx = mockSendEvidenceNeededAlert.mock.calls[0][0];
    expect(ctx.hasRealSupportComms).toBe(true);
    expect(ctx.hasRealDeliveryProof).toBe(true);
  });

  it("timeline comms WITH a real staff note → hasRealSupportComms true", async () => {
    const { sb } = makeRoutingSb({
      packSections: [
        {
          type: "comms",
          source: "shopify_timeline",
          fieldsProvided: ["customer_communication"],
          data: { summary: { staffNotePresent: true, merchantCommentCount: 0 } },
        },
      ],
    });
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await handleBuildPack(makeJob());

    expect(mockSendEvidenceNeededAlert.mock.calls[0][0].hasRealSupportComms).toBe(true);
  });

  it("bare label_created delivery → hasRealDeliveryProof false", async () => {
    const { sb } = makeRoutingSb({
      packSections: [
        {
          type: "shipping",
          source: "shopify_fulfillments",
          fieldsProvided: ["shipping_tracking"],
          data: { proofType: "label_created" },
        },
      ],
    });
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await handleBuildPack(makeJob());

    expect(mockSendEvidenceNeededAlert.mock.calls[0][0].hasRealDeliveryProof).toBe(false);
  });

  it("never passes a digital_access_logs concept to the email", async () => {
    const { sb } = makeRoutingSb({ packSections: [realDeliverySection] });
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await handleBuildPack(makeJob());

    const ctx = mockSendEvidenceNeededAlert.mock.calls[0][0];
    expect(ctx).not.toHaveProperty("digitalProof");
    expect(ctx).not.toHaveProperty("presentFields");
  });

  it("threads order_name into the email context for the subject", async () => {
    const { sb } = makeRoutingSb({ disputeRow: { order_name: "#1234" } });
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await handleBuildPack(makeJob());

    expect(mockSendEvidenceNeededAlert.mock.calls[0][0].orderName).toBe("#1234");
  });

  it("threads pendingSupportReview when Gorgias matched comms await review", async () => {
    const { sb } = makeRoutingSb({
      disputeRow: {
        needs_attention: true,
        attention_reason: "gorgias_evidence_ready",
        attention_payload: { proposal_count: 3, run_id: "run-1" },
      },
    });
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await handleBuildPack(makeJob());

    const ctx = mockSendEvidenceNeededAlert.mock.calls[0][0];
    expect(ctx.pendingSupportReview).toBe(true);
    expect(ctx.pendingSupportCount).toBe(3);
  });

  it("does NOT set pendingSupportReview for an unrelated attention reason", async () => {
    const { sb } = makeRoutingSb({
      disputeRow: {
        needs_attention: true,
        attention_reason: "quota_exceeded",
        attention_payload: { plan: "starter" },
      },
    });
    mockGetServiceClient.mockReturnValue(
      sb as unknown as ReturnType<typeof getServiceClient>,
    );

    await handleBuildPack(makeJob());

    const ctx = mockSendEvidenceNeededAlert.mock.calls[0][0];
    expect(ctx.pendingSupportReview).toBe(false);
    expect(ctx.pendingSupportCount).toBe(0);
  });
});
