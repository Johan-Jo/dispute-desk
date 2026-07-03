/**
 * Tests for the three blocked-exit branches of `runAutomationPipeline`.
 *
 * These branches (auto_build_off, quota_exceeded, feature_blocked)
 * previously returned a stringly-typed action and ran zero side
 * effects — the 2026-05-15 incident showed that a quota_exceeded
 * exit silently dropped every new dispute for the affected shop.
 *
 * Coverage targets:
 *   1. Each branch returns the documented action.
 *   2. Each branch writes an `auto_build_skipped` audit row.
 *   3. Each branch emits a `PACK_BLOCKED` dispute event.
 *   4. Each branch updates the dispute row with the canonical
 *      `attention_reason`, a typed `attention_payload`, and
 *      `needs_attention=true`.
 *   5. Each branch claims the throttled billing-blocked email slot
 *      and (when the slot is granted) calls the deferred-alert
 *      mailer in review variant.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/automation/settings", () => ({
  getShopSettings: vi.fn(),
}));
vi.mock("@/lib/billing/checkQuota", () => ({
  checkPackQuota: vi.fn(),
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
vi.mock("@/lib/automation/billingBlockedEmailThrottle", () => ({
  claimBillingBlockedEmailSlot: vi
    .fn()
    .mockResolvedValue({ allowed: true }),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { getShopSettings } from "@/lib/automation/settings";
import { checkPackQuota } from "@/lib/billing/checkQuota";
import { claimAndSendDeferredNewDisputeAlert } from "@/lib/email/sendNewDisputeAlert";
import { emitDisputeEvent } from "@/lib/disputeEvents/emitEvent";
import { claimBillingBlockedEmailSlot } from "@/lib/automation/billingBlockedEmailThrottle";
import { runAutomationPipeline } from "../pipeline";
import { DISPUTE_ATTENTION_REASONS } from "@/lib/disputes/attentionReasons";

const mockGetClient = vi.mocked(getServiceClient);
const mockGetShopSettings = vi.mocked(getShopSettings);
const mockCheckQuota = vi.mocked(checkPackQuota);
const mockEmail = vi.mocked(claimAndSendDeferredNewDisputeAlert);
const mockEmit = vi.mocked(emitDisputeEvent);
const mockClaimSlot = vi.mocked(claimBillingBlockedEmailSlot);

interface SbCapture {
  auditInserts: Array<Record<string, unknown>>;
  disputeUpdates: Array<Record<string, unknown>>;
}

function buildSb(capture: SbCapture) {
  const sb = {
    from: vi.fn((table: string) => {
      if (table === "audit_events") {
        return {
          insert: vi.fn().mockImplementation(async (row) => {
            capture.auditInserts.push(row);
            return { data: null, error: null };
          }),
        };
      }
      if (table === "disputes") {
        const handle = {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation(async () => {
              return { data: null, error: null };
            }),
          }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { due_at: null }, error: null }),
        };
        // Capture the update payload for assertions.
        handle.update = vi.fn().mockImplementation((row) => {
          capture.disputeUpdates.push(row);
          return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
        });
        return handle;
      }
      // Default — used for evidence_packs.maybeSingle in the "no
      // existing pack" code path even though blocked branches never
      // reach it.
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };
  return sb;
}

const DISPUTE = {
  id: "d-1",
  shop_id: "shop-1",
  reason: "FRAUDULENT",
  phase: "chargeback" as const,
  pack_template_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockClaimSlot.mockResolvedValue({ allowed: true });
});

describe("runAutomationPipeline — blocked-exit visibility", () => {
  it("auto_build_off → audit + dispute event + needs_attention + email", async () => {
    const capture: SbCapture = { auditInserts: [], disputeUpdates: [] };
    mockGetClient.mockReturnValue(buildSb(capture) as never);
    mockGetShopSettings.mockResolvedValue({
      auto_build_enabled: false,
      auto_save_enabled: false,
      auto_save_min_score: 80,
      enforce_no_blockers: true,
    } as never);

    const res = await runAutomationPipeline(DISPUTE);

    expect(res.action).toBe("skipped_auto_build_off");
    expect(capture.auditInserts).toHaveLength(1);
    expect(capture.auditInserts[0]).toMatchObject({
      event_type: "auto_build_skipped",
      event_payload: { reason: DISPUTE_ATTENTION_REASONS.AUTO_BUILD_OFF },
    });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit.mock.calls[0][0]).toMatchObject({
      eventType: "pack_blocked",
      disputeId: "d-1",
    });
    expect(capture.disputeUpdates[0]).toMatchObject({
      needs_attention: true,
      attention_reason: DISPUTE_ATTENTION_REASONS.AUTO_BUILD_OFF,
      next_action_type: "billing",
    });
    expect(mockClaimSlot).toHaveBeenCalledTimes(1);
    expect(mockEmail).toHaveBeenCalledWith("d-1", "review");
  });

  it("quota_exceeded → structured payload + email", async () => {
    const capture: SbCapture = { auditInserts: [], disputeUpdates: [] };
    mockGetClient.mockReturnValue(buildSb(capture) as never);
    mockGetShopSettings.mockResolvedValue({
      auto_build_enabled: true,
      auto_save_enabled: true,
      auto_save_min_score: 80,
      enforce_no_blockers: true,
    } as never);
    mockCheckQuota.mockResolvedValue({
      allowed: false,
      plan: "growth",
      used: 75,
      remaining: 0,
      limit: 75,
      reason: "Pack limit reached.",
    });

    const res = await runAutomationPipeline(DISPUTE);

    expect(res.action).toBe("quota_exceeded");
    expect(capture.auditInserts[0]).toMatchObject({
      event_type: "auto_build_skipped",
      event_payload: {
        reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
        plan: "growth",
        remaining: 0,
        limit: 75,
        used: 75,
      },
    });
    expect(capture.disputeUpdates[0]).toMatchObject({
      needs_attention: true,
      attention_reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
      attention_payload: { plan: "growth", remaining: 0, limit: 75 },
    });
    expect(mockClaimSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: DISPUTE_ATTENTION_REASONS.QUOTA_EXCEEDED,
      }),
    );
    expect(mockEmail).toHaveBeenCalledWith("d-1", "review");
  });

  it("free plan is NOT tier-blocked — passes the gate when credits remain", async () => {
    // Regression: free tier previously hit a checkFeatureAccess("autoPack")
    // tier gate and got "Auto-build is a paid feature" even with credits. Now
    // auto-build is credit-gated only. With credits remaining, a free shop
    // passes quota and reaches the pack stage — here an existing pack short-
    // circuits so we don't need the full build path mocked. The point: no
    // feature-block audit/event was written.
    const capture: SbCapture = { auditInserts: [], disputeUpdates: [] };
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "disputes") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            // First call = terminal-guard lookup (non-terminal).
            maybeSingle: vi
              .fn()
              .mockResolvedValueOnce({
                data: { final_outcome: null, closed_at: null, normalized_status: "needs_review" },
                error: null,
              })
              .mockResolvedValue({ data: null, error: null }),
            update: vi.fn().mockImplementation((row) => {
              capture.disputeUpdates.push(row);
              return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
            }),
          };
        }
        if (table === "evidence_packs") {
          // An existing pack → pipeline returns "existing_pack" (clean exit).
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { id: "pack-1", status: "queued" }, error: null }),
          };
        }
        return {
          insert: vi.fn().mockImplementation(async (row) => {
            capture.auditInserts.push(row);
            return { data: null, error: null };
          }),
        };
      }),
    };
    mockGetClient.mockReturnValue(sb as never);
    mockGetShopSettings.mockResolvedValue({
      auto_build_enabled: true,
      auto_save_enabled: false,
      auto_save_min_score: 80,
      enforce_no_blockers: true,
    } as never);
    mockCheckQuota.mockResolvedValue({
      allowed: true,
      plan: "free",
      used: 0,
      remaining: 3,
      limit: 5,
    });

    const res = await runAutomationPipeline(DISPUTE);

    expect(res.action).toBe("existing_pack");
    // No "paid feature" block was written.
    expect(
      capture.auditInserts.some(
        (a) => (a.event_payload as { reason?: string })?.reason === "feature_blocked",
      ),
    ).toBe(false);
  });

  it("terminal dispute (won/closed) → skipped_terminal with NO side effects", async () => {
    const capture: SbCapture = { auditInserts: [], disputeUpdates: [] };
    // Terminal dispute: the guard reads final_outcome/closed_at/normalized_status
    // from the FIRST disputes lookup.
    const sb = {
      from: vi.fn((table: string) => {
        if (table === "disputes") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { final_outcome: "won", closed_at: null, normalized_status: "won" },
              error: null,
            }),
            update: vi.fn().mockImplementation((row) => {
              capture.disputeUpdates.push(row);
              return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
            }),
          };
        }
        return {
          insert: vi.fn().mockImplementation(async (row) => {
            capture.auditInserts.push(row);
            return { data: null, error: null };
          }),
        };
      }),
    };
    mockGetClient.mockReturnValue(sb as never);

    const res = await runAutomationPipeline(DISPUTE);

    expect(res.action).toBe("skipped_terminal");
    // Never emits a blocked event, never spends anything, never flags attention.
    expect(capture.auditInserts).toHaveLength(0);
    expect(capture.disputeUpdates).toHaveLength(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("when throttle denies the slot, audit + dispute event + needs_attention still fire", async () => {
    mockClaimSlot.mockResolvedValueOnce({
      allowed: false,
      reason: "throttled_same_reason",
    });
    const capture: SbCapture = { auditInserts: [], disputeUpdates: [] };
    mockGetClient.mockReturnValue(buildSb(capture) as never);
    mockGetShopSettings.mockResolvedValue({
      auto_build_enabled: true,
      auto_save_enabled: true,
      auto_save_min_score: 80,
      enforce_no_blockers: true,
    } as never);
    mockCheckQuota.mockResolvedValue({
      allowed: false,
      plan: "growth",
      used: 75,
      remaining: 0,
      limit: 75,
    });

    const res = await runAutomationPipeline(DISPUTE);

    expect(res.action).toBe("quota_exceeded");
    expect(capture.auditInserts).toHaveLength(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(capture.disputeUpdates).toHaveLength(1);
    // Email is the ONLY thing throttled.
    expect(mockEmail).not.toHaveBeenCalled();
  });
});
