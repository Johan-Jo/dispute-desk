/**
 * Tests for the shared dispatcher (Phase 5).
 *
 * Covers:
 *   - applied → DISPUTE_OPENED fires evaluateRules → runAutomationPipeline,
 *     and sends the review-variant alert when no build was enqueued
 *   - applied → DISPUTE_OPENED with pipeline action=pack_enqueued defers
 *     the email (no sendNewDisputeAlert call)
 *   - applied → SUBMISSION_CONFIRMED calls claimAndSendDeferredNewDisputeAlert
 *     with "auto" mode
 *   - applied → STATUS_CHANGED / DUE_DATE_CHANGED have NO downstream effects
 *   - skipped_unchanged → dispatcher noop
 *   - effect-level idempotency: cron + webhook with the same event_key →
 *     effect runs once (Layer B 23505 collision on audit_events)
 *   - an effect throwing does not block subsequent effects
 *   - skipAutomation=true short-circuits pipeline
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/automation/pipeline", () => ({
  runAutomationPipeline: vi.fn(),
}));
vi.mock("@/lib/rules/evaluateRules", () => ({
  evaluateRules: vi.fn(),
}));
vi.mock("@/lib/email/sendNewDisputeAlert", () => ({
  sendNewDisputeAlert: vi.fn(),
  claimAndSendDeferredNewDisputeAlert: vi.fn(),
}));
vi.mock("@/lib/email/sendOutcomePostedAlert", () => ({
  sendOutcomePostedAlert: vi.fn(),
}));

import { dispatchDisputeEffects } from "@/lib/disputes/disputeEffectsDispatcher";
import { getServiceClient } from "@/lib/supabase/server";
import { runAutomationPipeline } from "@/lib/automation/pipeline";
import { evaluateRules } from "@/lib/rules/evaluateRules";
import {
  sendNewDisputeAlert,
  claimAndSendDeferredNewDisputeAlert,
} from "@/lib/email/sendNewDisputeAlert";
import { sendOutcomePostedAlert } from "@/lib/email/sendOutcomePostedAlert";
import type {
  ApplyDisputeSnapshotResult,
  DisputeTransitionEvent,
} from "@/lib/disputes/applyDisputeSnapshot";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockRunPipeline = vi.mocked(runAutomationPipeline);
const mockEvaluateRules = vi.mocked(evaluateRules);
const mockSendAlert = vi.mocked(sendNewDisputeAlert);
const mockClaimDeferred = vi.mocked(claimAndSendDeferredNewDisputeAlert);
const mockSendOutcome = vi.mocked(sendOutcomePostedAlert);

interface ClientSetup {
  auditInsertResolved?: { error: { code?: string; message?: string } | null };
  disputeClaim?: Array<{ id: string; order_name?: string | null }> | null;
}

/** Minimal Supabase shim covering audit_events.insert + disputes.update.eq.is.select. */
function buildClient(setup: ClientSetup) {
  const auditInsert = vi
    .fn()
    .mockResolvedValue(setup.auditInsertResolved ?? { error: null });

  const claimRows = setup.disputeClaim ?? [{ id: "dispute-1", order_name: "#1001" }];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table === "audit_events") {
      return { insert: auditInsert };
    }
    if (table === "disputes") {
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: claimRows, error: null }),
            }),
            // .update().eq() (needs_review path) — no further chaining needed.
            then: undefined,
          }),
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };

  const client = { from: fromImpl } as unknown as never;
  return { client, auditInsert };
}

const OPENED_EVENT: DisputeTransitionEvent = {
  type: "DISPUTE_OPENED",
  disputeId: "dispute-1",
  shopId: "shop-1",
  eventAt: "2026-05-19T12:00:00Z",
  eventKey: "dispute-1:DISPUTE_OPENED",
  newStatus: "needs_response",
  context: {
    reason: "fraudulent",
    phase: "chargeback",
    amount: 432.9,
    currency: "USD",
    dueAt: "2026-05-26T12:00:00Z",
    orderGid: "gid://shopify/Order/9876",
    disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/777",
  },
};

const SUBMISSION_CONFIRMED_EVENT: DisputeTransitionEvent = {
  type: "SUBMISSION_CONFIRMED",
  disputeId: "dispute-1",
  shopId: "shop-1",
  eventAt: "2026-05-21T12:00:00Z",
  eventKey: "dispute-1:SUBMISSION_CONFIRMED:2026-05-21T12:00:00Z",
  context: OPENED_EVENT.context,
};

const STATUS_CHANGED_EVENT: DisputeTransitionEvent = {
  type: "STATUS_CHANGED",
  disputeId: "dispute-1",
  shopId: "shop-1",
  eventAt: "2026-05-19T13:00:00Z",
  eventKey: "dispute-1:STATUS_CHANGED:needs_response_under_review",
  oldStatus: "needs_response",
  newStatus: "under_review",
  context: OPENED_EVENT.context,
};

function appliedResult(
  events: DisputeTransitionEvent[],
): ApplyDisputeSnapshotResult {
  return {
    outcome: "applied",
    localDisputeId: "dispute-1",
    events,
    guardWarnings: [],
    created: false,
  };
}

describe("dispatchDisputeEffects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvaluateRules.mockResolvedValue({
      action: { mode: "review", pack_template_id: null },
      packTemplateId: null,
    } as never);
    mockRunPipeline.mockResolvedValue({ action: "pack_enqueued" } as never);
  });

  it("DISPUTE_OPENED with no enqueued build → sends review-variant alert", async () => {
    const { client } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);
    // Pipeline did NOT enqueue a build — alert should fire from the dispatcher.
    mockRunPipeline.mockResolvedValue({
      action: "skipped_auto_build_off",
    } as never);

    const summary = await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([OPENED_EVENT]),
      source: "webhook",
      client,
    });

    expect(summary.effectsRan).toBe(1);
    expect(mockEvaluateRules).toHaveBeenCalled();
    expect(mockRunPipeline).toHaveBeenCalled();
    expect(mockSendAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: "dispute-1",
        resolvedMode: "review",
        reason: "fraudulent",
      }),
    );
  });

  it("DISPUTE_OPENED with pipeline pack_enqueued → defers email (NO sendNewDisputeAlert)", async () => {
    const { client } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);
    mockRunPipeline.mockResolvedValue({ action: "pack_enqueued" } as never);

    await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([OPENED_EVENT]),
      source: "webhook",
      client,
    });

    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  it("SUBMISSION_CONFIRMED → claimAndSendDeferredNewDisputeAlert with 'auto'", async () => {
    const { client } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);

    await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([SUBMISSION_CONFIRMED_EVENT]),
      source: "webhook",
      client,
    });

    expect(mockClaimDeferred).toHaveBeenCalledWith("dispute-1", "auto");
  });

  it("STATUS_CHANGED is dispatcher-noop (no effects attempted)", async () => {
    const { client, auditInsert } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);

    const summary = await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([STATUS_CHANGED_EVENT]),
      source: "cron",
      client,
    });

    expect(summary.effectsAttempted).toBe(0);
    expect(auditInsert).not.toHaveBeenCalled();
    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  it("skipped_unchanged → dispatcher fires zero effects", async () => {
    const { client, auditInsert } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);

    const summary = await dispatchDisputeEffects({
      shopId: "shop-1",
      result: {
        outcome: "skipped_unchanged",
        localDisputeId: "dispute-1",
        events: [],
        guardWarnings: [],
        created: false,
      },
      source: "webhook",
      client,
    });

    expect(summary.effectsAttempted).toBe(0);
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("effect idempotency: second observer of same eventKey → claim 23505, effect skipped", async () => {
    const { client } = buildClient({
      auditInsertResolved: {
        error: { code: "23505", message: "duplicate key value" },
      },
    });
    mockGetServiceClient.mockReturnValue(client);
    mockRunPipeline.mockResolvedValue({
      action: "skipped_auto_build_off",
    } as never);

    const summary = await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([OPENED_EVENT]),
      source: "cron",
      client,
    });

    expect(summary.effectsRan).toBe(0);
    expect(summary.effectsSkipped).toBe(1);
    expect(mockEvaluateRules).not.toHaveBeenCalled();
    expect(mockRunPipeline).not.toHaveBeenCalled();
    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  it("an effect throwing does not block subsequent effects", async () => {
    const { client } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);
    // First effect throws.
    mockEvaluateRules.mockRejectedValueOnce(new Error("transient"));
    mockRunPipeline.mockResolvedValue({
      action: "skipped_auto_build_off",
    } as never);

    const summary = await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([OPENED_EVENT, SUBMISSION_CONFIRMED_EVENT]),
      source: "webhook",
      client,
    });

    expect(mockClaimDeferred).toHaveBeenCalledWith("dispute-1", "auto");
    expect(summary.errors.join("|")).toMatch(/rules\(dispute-1\)/);
  });

  // ── Historical-import suppression (first-sync email-flood guard) ────────
  //
  // Regression for the cay-collective incident (2026-07-02): the first full
  // dispute sync of an established shop imported 65 historical disputes, 61
  // already terminal, and each fired a "you won / this chargeback was lost"
  // (outcome) + "ready for your review" (opened) email. applyDisputeSnapshot
  // now flags create-branch events for already-resolved disputes as
  // historicalImport; the dispatcher must NOT email for them.

  it("historical-import DISPUTE_OPENED → burns the alert claim, no pipeline, no email", async () => {
    const { client } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);

    const summary = await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([{ ...OPENED_EVENT, historicalImport: true }]),
      source: "cron",
      client,
    });

    // Effect still "ran" (claimed the dedup row) but no work leaked out.
    expect(summary.effectsRan).toBe(1);
    expect(mockEvaluateRules).not.toHaveBeenCalled();
    expect(mockRunPipeline).not.toHaveBeenCalled();
    expect(mockSendAlert).not.toHaveBeenCalled();
    expect(mockClaimDeferred).not.toHaveBeenCalled();
  });

  it("historical-import OUTCOME_DETECTED → no 'you won/lost' email", async () => {
    const { client } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);

    const summary = await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([
        {
          type: "OUTCOME_DETECTED",
          disputeId: "dispute-1",
          shopId: "shop-1",
          eventAt: "2024-08-27T04:29:52Z",
          eventKey: "dispute-1:OUTCOME_DETECTED:won",
          newStatus: "won",
          context: { ...OPENED_EVENT.context, finalOutcome: "won" },
          historicalImport: true,
        },
      ]),
      source: "cron",
      client,
    });

    expect(summary.effectsSkipped).toBe(1);
    expect(mockSendOutcome).not.toHaveBeenCalled();
  });

  it("historical-import SUBMISSION_CONFIRMED → no deferred auto alert", async () => {
    const { client } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);

    await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([
        { ...SUBMISSION_CONFIRMED_EVENT, historicalImport: true },
      ]),
      source: "cron",
      client,
    });

    expect(mockClaimDeferred).not.toHaveBeenCalled();
  });

  it("NON-historical OUTCOME_DETECTED still emails (guard is scoped to imports)", async () => {
    // A real, live outcome transition on an already-known dispute must keep
    // notifying — the dispatcher looks up order_name then sends the alert.
    const outcomeClient = {
      from: (table: string) => {
        if (table === "audit_events") {
          return { insert: vi.fn().mockResolvedValue({ error: null }) };
        }
        if (table === "disputes") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: { order_name: "#3018" }, error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    } as unknown as never;
    mockGetServiceClient.mockReturnValue(outcomeClient);

    await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([
        {
          type: "OUTCOME_DETECTED",
          disputeId: "dispute-1",
          shopId: "shop-1",
          eventAt: "2026-07-02T13:00:00Z",
          eventKey: "dispute-1:OUTCOME_DETECTED:won",
          newStatus: "won",
          context: { ...OPENED_EVENT.context, finalOutcome: "won" },
          // historicalImport intentionally omitted → live transition.
        },
      ]),
      source: "webhook",
      client: outcomeClient,
    });

    expect(mockSendOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ disputeId: "dispute-1", outcome: "won" }),
    );
  });

  it("skipAutomation=true skips runAutomationPipeline but STILL evaluates rules + sends review alert (matches legacy syncDisputes triggerAutomation=false behaviour)", async () => {
    const { client } = buildClient({});
    mockGetServiceClient.mockReturnValue(client);

    await dispatchDisputeEffects({
      shopId: "shop-1",
      result: appliedResult([OPENED_EVENT]),
      source: "cron",
      skipAutomation: true,
      client,
    });

    expect(mockEvaluateRules).toHaveBeenCalled();
    expect(mockRunPipeline).not.toHaveBeenCalled();
    expect(mockSendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ resolvedMode: "review" }),
    );
  });
});
