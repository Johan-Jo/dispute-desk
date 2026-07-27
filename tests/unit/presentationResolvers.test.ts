/**
 * Shared presentation resolvers — §15 truth tables.
 *
 * Pins the plan's invariants (docs/plans/
 * design-alignment-shared-presentation-model.plan.md):
 * - lifecycle from objective facts only; attention never mutates it
 * - saved never implies sent; submission_state authoritative
 * - recommended/opportunity are not merchant tasks; requested/blocking are
 * - internal failures are transparency, not Action required
 * - buckets are a mutually-exclusive complete partition
 */
import { describe, expect, it } from "vitest";
import {
  ACTION_REQUIRED_ATTENTION,
  dashboardBucket,
  isActiveNormalizedStatus,
  resolveAttention,
  resolveLifecycle,
  resolvePresentation,
  resolveStrength,
  type AttentionInput,
  type LifecycleInput,
  type PresentationInput,
} from "@/lib/disputes/presentation";

// ── helpers ─────────────────────────────────────────────────────────────

const baseLifecycle: LifecycleInput = {
  finalOutcome: null,
  closedAt: null,
  submissionState: "not_saved",
  normalizedStatus: "in_progress",
  packStatus: null,
};

const baseAttention: AttentionInput = {
  attentionReason: null,
  needsAttention: false,
  integrationReconnectRequired: false,
  gorgiasActionableCount: 0,
  automationMode: "auto",
  packStatus: null,
  approvedForSaveAt: null,
  concreteContribution: null,
  packFailed: false,
  gorgiasEvidenceStale: false,
  submissionUncertain: false,
  terminal: false,
  transmissionConfirmed: false,
};

const basePresentation: PresentationInput = {
  ...baseLifecycle,
  strengthOverall: "moderate",
  attentionReason: null,
  needsAttention: false,
  integrationReconnectRequired: false,
  gorgiasActionableCount: 0,
  automationMode: "auto",
  approvedForSaveAt: null,
  concreteContribution: null,
  gorgiasEvidenceStale: false,
};

// ── lifecycle ───────────────────────────────────────────────────────────

describe("resolveLifecycle", () => {
  it("terminal: won/lost from final_outcome; other outcomes → closed", () => {
    expect(resolveLifecycle({ ...baseLifecycle, finalOutcome: "won" })).toBe("won");
    expect(resolveLifecycle({ ...baseLifecycle, finalOutcome: "lost" })).toBe("lost");
    expect(resolveLifecycle({ ...baseLifecycle, finalOutcome: "accepted" })).toBe("closed");
    expect(resolveLifecycle({ ...baseLifecycle, finalOutcome: "refunded" })).toBe("closed");
  });

  it("terminal-without-outcome: closed_at set with null final_outcome → closed (never orphaned)", () => {
    expect(
      resolveLifecycle({
        ...baseLifecycle,
        closedAt: "2026-07-01T00:00:00Z",
        finalOutcome: null,
      }),
    ).toBe("closed");
  });

  it("confirmed transmission → under_review (sent is a milestone, not a state)", () => {
    expect(
      resolveLifecycle({ ...baseLifecycle, submissionState: "submitted_confirmed" }),
    ).toBe("under_review");
    // External Shopify under_review status (normalized submitted_to_bank).
    expect(
      resolveLifecycle({ ...baseLifecycle, normalizedStatus: "submitted_to_bank" }),
    ).toBe("under_review");
  });

  it("saved: submission_state is authoritative", () => {
    expect(
      resolveLifecycle({ ...baseLifecycle, submissionState: "saved_to_shopify" }),
    ).toBe("saved_to_shopify");
  });

  it("PresentationStatus fallback never overrides an explicit not_saved", () => {
    expect(
      resolveLifecycle({
        ...baseLifecycle,
        submissionState: "not_saved",
        presentationSavedFallback: true,
        packStatus: "ready",
      }),
    ).toBe("pack_prepared"); // not saved_to_shopify
  });

  it("PresentationStatus fallback applies only when submission_state is missing/unrecognized", () => {
    expect(
      resolveLifecycle({
        ...baseLifecycle,
        submissionState: null,
        presentationSavedFallback: true,
      }),
    ).toBe("saved_to_shopify");
    expect(
      resolveLifecycle({
        ...baseLifecycle,
        submissionState: "some_future_value",
        presentationSavedFallback: true,
      }),
    ).toBe("saved_to_shopify");
  });

  it("manual_submission_reported is NOT transmission-confirmed and NOT saved", () => {
    const lc = resolveLifecycle({
      ...baseLifecycle,
      submissionState: "manual_submission_reported",
      packStatus: "ready",
    });
    expect(lc).toBe("pack_prepared");
  });

  it("pack_prepared only from the verified ready state (and save_failed, which implies ready)", () => {
    expect(resolveLifecycle({ ...baseLifecycle, packStatus: "ready" })).toBe("pack_prepared");
    expect(resolveLifecycle({ ...baseLifecycle, packStatus: "save_failed" })).toBe("pack_prepared");
    // Mere existence of a draft/blocked record is NOT prepared (§9).
    expect(resolveLifecycle({ ...baseLifecycle, packStatus: "draft" })).toBe("building_evidence");
    expect(resolveLifecycle({ ...baseLifecycle, packStatus: "blocked" })).toBe("building_evidence");
  });

  it("build in progress → building_evidence", () => {
    for (const s of ["queued", "building", "saving"]) {
      expect(resolveLifecycle({ ...baseLifecycle, packStatus: s })).toBe("building_evidence");
    }
  });

  it("failed/interrupted build with nothing prepared is NEVER a false Monitoring", () => {
    expect(resolveLifecycle({ ...baseLifecycle, packStatus: "failed" })).toBe("building_evidence");
    expect(resolveLifecycle({ ...baseLifecycle, packStatus: null })).toBe("building_evidence");
    expect(resolveLifecycle({ ...baseLifecycle, packStatus: "archived" })).toBe("building_evidence");
  });

  it("strength/coverage/attention are not inputs (objective facts only)", () => {
    // Compile-time: LifecycleInput has no strength/coverage/attention
    // fields. Runtime spot-check: identical facts → identical lifecycle.
    const a = resolveLifecycle({ ...baseLifecycle, packStatus: "ready" });
    const b = resolveLifecycle({ ...baseLifecycle, packStatus: "ready" });
    expect(a).toBe(b);
  });
});

// ── attention ───────────────────────────────────────────────────────────

describe("resolveAttention", () => {
  it("merchant-resolvable reconnect → technical_error (Action required)", () => {
    const r = resolveAttention({ ...baseAttention, integrationReconnectRequired: true });
    expect(r.attention).toBe("technical_error");
    expect(ACTION_REQUIRED_ATTENTION.has(r.attention)).toBe(true);
  });

  it("internal failures are transparency only — never merchant attention", () => {
    // submission_failed (decided: internal only)
    const saveFail = resolveAttention({
      ...baseAttention,
      needsAttention: true,
      attentionReason: "submission_failed",
    });
    expect(saveFail.attention).toBe("none");
    expect(saveFail.internalIssue).toBe(true);

    // failed pack build
    const buildFail = resolveAttention({ ...baseAttention, packFailed: true });
    expect(buildFail.attention).toBe("none");
    expect(buildFail.internalIssue).toBe(true);

    // gorgiasEvidenceStale alone is especially insufficient
    const stale = resolveAttention({ ...baseAttention, gorgiasEvidenceStale: true });
    expect(stale.attention).toBe("none");
    expect(stale.internalIssue).toBe(true);

    // submission_uncertain
    const uncertain = resolveAttention({ ...baseAttention, submissionUncertain: true });
    expect(uncertain.attention).toBe("none");
    expect(uncertain.internalIssue).toBe(true);
  });

  it("blocking fires with NO deadline present (blocked ≠ deadline-driven)", () => {
    for (const reason of [
      "quota_exceeded",
      "feature_blocked",
      "subscription_expired",
      "payment_failed",
      "missing_required_evidence",
      "auto_build_off",
    ]) {
      const r = resolveAttention({
        ...baseAttention,
        needsAttention: true,
        attentionReason: reason,
      });
      expect(r.attention).toBe("blocking");
    }
  });

  it("review-mode approval gate → blocking (ready + unapproved)", () => {
    const r = resolveAttention({
      ...baseAttention,
      automationMode: "review",
      packStatus: "ready",
      approvedForSaveAt: null,
    });
    expect(r.attention).toBe("blocking");
    // Approved → gate cleared.
    const approved = resolveAttention({
      ...baseAttention,
      automationMode: "review",
      packStatus: "ready",
      approvedForSaveAt: "2026-07-20T00:00:00Z",
    });
    expect(approved.attention).toBe("none");
    // Auto mode → no gate.
    const auto = resolveAttention({
      ...baseAttention,
      automationMode: "auto",
      packStatus: "ready",
    });
    expect(auto.attention).toBe("none");
  });

  it("explicit asks → requested (Gorgias review, deadline re-ask)", () => {
    const gorgias = resolveAttention({ ...baseAttention, gorgiasActionableCount: 2 });
    expect(gorgias.attention).toBe("requested");
    const reask = resolveAttention({
      ...baseAttention,
      needsAttention: true,
      attentionReason: "review_deadline_approaching",
    });
    expect(reask.attention).toBe("requested");
  });

  it("generic 'recommended' contribution NO LONGER raises attention (removed 2026-07-27) — stays none", () => {
    // Almost every dispute improves with customer communication, so the
    // generic "communication may strengthen this" state was removed. A
    // concrete contribution no longer produces a merchant task.
    const r = resolveAttention({ ...baseAttention, concreteContribution: "recommended" });
    expect(r.attention).toBe("none");
    const none = resolveAttention({ ...baseAttention });
    expect(none.attention).toBe("none");
  });

  it("generic 'optional' contribution also stays none (opportunity state removed)", () => {
    const r = resolveAttention({ ...baseAttention, concreteContribution: "optional" });
    expect(r.attention).toBe("none");
  });

  it("mutual exclusivity: blocking > requested; a concrete contribution never wins", () => {
    const r = resolveAttention({
      ...baseAttention,
      needsAttention: true,
      attentionReason: "missing_required_evidence",
      gorgiasActionableCount: 3,
      concreteContribution: "recommended",
    });
    expect(r.attention).toBe("blocking");
    const r2 = resolveAttention({
      ...baseAttention,
      gorgiasActionableCount: 3,
      concreteContribution: "recommended",
    });
    expect(r2.attention).toBe("requested");
    // concreteContribution alone → none (no longer a task).
    const r3 = resolveAttention({ ...baseAttention, concreteContribution: "recommended" });
    expect(r3.attention).toBe("none");
  });

  it("stale-attention guard: terminal and under-review never yield tasks", () => {
    const terminal = resolveAttention({
      ...baseAttention,
      terminal: true,
      needsAttention: true,
      attentionReason: "missing_required_evidence",
      gorgiasActionableCount: 5,
    });
    expect(terminal.attention).toBe("none");
    const sent = resolveAttention({
      ...baseAttention,
      transmissionConfirmed: true,
      gorgiasActionableCount: 5,
    });
    expect(sent.attention).toBe("none");
  });
});

// ── strength ────────────────────────────────────────────────────────────

describe("resolveStrength", () => {
  it("passes the rules-engine grade through verbatim", () => {
    expect(resolveStrength("strong")).toBe("strong");
    expect(resolveStrength("moderate")).toBe("moderate");
    expect(resolveStrength("weak")).toBe("weak");
  });
  it("insufficient (and missing) → not_assessed, distinct from weak", () => {
    expect(resolveStrength("insufficient")).toBe("not_assessed");
    expect(resolveStrength(null)).toBe("not_assessed");
    expect(resolveStrength(undefined)).toBe("not_assessed");
  });
});

// ── composition + buckets ───────────────────────────────────────────────

describe("resolvePresentation + dashboardBucket", () => {
  it("saved never implies sent", () => {
    const p = resolvePresentation({
      ...basePresentation,
      submissionState: "saved_to_shopify",
    });
    expect(p.lifecycle).toBe("saved_to_shopify");
    expect(p.transmissionConfirmed).toBe(false);
    expect(p.editable).toBe(true);
    expect(dashboardBucket(p)).toBe("building_monitoring");
  });

  it("confirmed transmission → under_review, locked, Under review bucket", () => {
    const p = resolvePresentation({
      ...basePresentation,
      submissionState: "submitted_confirmed",
    });
    expect(p.lifecycle).toBe("under_review");
    expect(p.transmissionConfirmed).toBe(true);
    expect(p.editable).toBe(false);
    expect(dashboardBucket(p)).toBe("under_review");
  });

  it("a concrete contribution is NOT a task (generic recommended removed); only requested is", () => {
    const rec = resolvePresentation({
      ...basePresentation,
      packStatus: "saved_to_shopify",
      submissionState: "saved_to_shopify",
      concreteContribution: "recommended",
    });
    expect(rec.attention).toBe("none");
    expect(rec.needsMerchantAction).toBe(false);
    expect(dashboardBucket(rec)).toBe("building_monitoring");

    const req = resolvePresentation({
      ...basePresentation,
      gorgiasActionableCount: 1,
    });
    expect(req.attention).toBe("requested");
    expect(req.needsMerchantAction).toBe(true);
    expect(dashboardBucket(req)).toBe("action_required");
  });

  it("closed/under-review precedence beats stale attention", () => {
    const closedStale = resolvePresentation({
      ...basePresentation,
      closedAt: "2026-07-01T00:00:00Z",
      needsAttention: true,
      attentionReason: "missing_required_evidence",
      gorgiasActionableCount: 4,
    });
    expect(dashboardBucket(closedStale)).toBe("closed");
    expect(closedStale.attention).toBe("none");
  });

  it("internal technical failure keeps lifecycle objective and bucket calm", () => {
    const p = resolvePresentation({
      ...basePresentation,
      packStatus: "failed",
    });
    expect(p.lifecycle).toBe("building_evidence"); // never a lifecycle error state
    expect(p.attention).toBe("none");
    expect(p.internalIssue).toBe(true);
    expect(dashboardBucket(p)).toBe("building_monitoring");
  });

  it("merchant-resolvable technical error → Action required, lifecycle unchanged", () => {
    const p = resolvePresentation({
      ...basePresentation,
      packStatus: "saved_to_shopify",
      submissionState: "saved_to_shopify",
      integrationReconnectRequired: true,
    });
    expect(p.lifecycle).toBe("saved_to_shopify");
    expect(p.attention).toBe("technical_error");
    expect(dashboardBucket(p)).toBe("action_required");
  });

  it("terminal-without-outcome lands in Closed (complete partition, no orphans)", () => {
    const p = resolvePresentation({
      ...basePresentation,
      closedAt: "2026-07-01T00:00:00Z",
      finalOutcome: null,
      normalizedStatus: "closed_other",
    });
    expect(p.lifecycle).toBe("closed");
    expect(p.outcome).toBe("closed");
    expect(p.isActive).toBe(false);
    expect(dashboardBucket(p)).toBe("closed");
  });

  it("every combination lands in exactly one bucket (fuzz sweep)", () => {
    const outcomes = [null, "won", "lost", "accepted"];
    const closed = [null, "2026-07-01T00:00:00Z"];
    const subs = [null, "not_saved", "saved_to_shopify", "submitted_confirmed", "submission_uncertain", "manual_submission_reported", "weird"];
    const packs = [null, "queued", "building", "ready", "save_failed", "failed", "saved_to_shopify", "archived", "blocked"];
    const reasons = [null, "missing_required_evidence", "gorgias_evidence_ready", "submission_failed", "quota_exceeded"];
    const buckets = new Set(["closed", "under_review", "action_required", "building_monitoring"]);
    for (const finalOutcome of outcomes)
      for (const closedAt of closed)
        for (const submissionState of subs)
          for (const packStatus of packs)
            for (const attentionReason of reasons) {
              const p = resolvePresentation({
                ...basePresentation,
                finalOutcome,
                closedAt,
                submissionState,
                packStatus,
                attentionReason,
                needsAttention: attentionReason != null,
              });
              expect(buckets.has(dashboardBucket(p))).toBe(true);
            }
  });

  it("under-review disputes are ACTIVE inventory (allow-list, not final_outcome null)", () => {
    const p = resolvePresentation({
      ...basePresentation,
      submissionState: "submitted_confirmed",
      normalizedStatus: "submitted_to_bank",
    });
    expect(p.isActive).toBe(true);
    // Terminal normalized status with null outcome is NOT active.
    expect(isActiveNormalizedStatus("accepted_not_contested")).toBe(false);
    expect(isActiveNormalizedStatus("closed_other")).toBe(false);
    expect(isActiveNormalizedStatus("submitted_to_bank")).toBe(true);
    expect(isActiveNormalizedStatus("waiting_on_issuer")).toBe(true); // legacy rows
  });
});

// ── Cross-page consistency (§15) ────────────────────────────────────────
// The same dispute facts must resolve identically wherever they are
// consumed: the list's primary-state map, the dashboard bucketer, and
// the detail heading all read the SAME DisputePresentation.

import { listPrimaryState } from "@/lib/disputes/presentation/labels";

describe("Cross-page consistency", () => {
  it("a requested (Gorgias review) case reads identically on all three surfaces", () => {
    const p = resolvePresentation({
      ...basePresentation,
      gorgiasActionableCount: 2,
    });
    // Detail heading: attention pill 'requested'; list: Review
    // communication; dashboard: Action required — one interpretation.
    expect(p.attention).toBe("requested");
    expect(listPrimaryState(p).labelKey).toBe("presentation.listState.requested");
    expect(dashboardBucket(p)).toBe("action_required");
    expect(p.needsMerchantAction).toBe(true);
  });

  it("a recorded review decision overrides the attention-derived list status", () => {
    // Approval gate is still technically open (attention=blocking/
    // approval_gate) but the merchant already decided — the list must
    // stop saying 'Approval required' and reflect the standing decision.
    const p = resolvePresentation({
      ...basePresentation,
      automationMode: "review",
      packStatus: "ready",
      approvedForSaveAt: null,
    });
    expect(p.attention).toBe("blocking");
    expect(p.blockingReason).toBe("approval_gate");
    // No decision yet → shows the approval label.
    expect(listPrimaryState(p).labelKey).toBe(
      "presentation.attentionBlocking.approval_gate",
    );
    // Decision recorded → reflects it, not 'Approval required'.
    expect(listPrimaryState(p, "approved").labelKey).toBe(
      "presentation.reviewDecision.approved",
    );
    expect(listPrimaryState(p, "conceded").labelKey).toBe(
      "presentation.reviewDecision.conceded",
    );
    expect(listPrimaryState(p, "in_review").labelKey).toBe(
      "presentation.reviewDecision.in_review",
    );
  });

  it("a saved-editable case is calm everywhere (no task, no warning)", () => {
    const p = resolvePresentation({
      ...basePresentation,
      submissionState: "saved_to_shopify",
      packStatus: "saved_to_shopify",
    });
    expect(p.lifecycle).toBe("saved_to_shopify");
    expect(p.attention).toBe("none");
    expect(listPrimaryState(p)).toEqual({
      labelKey: "presentation.lifecycle.saved_to_shopify",
      subKey: "presentation.lifecycleSub.saved_to_shopify",
    });
    expect(dashboardBucket(p)).toBe("building_monitoring");
    expect(p.editable).toBe(true); // Monitoring ≠ Done
  });

  it("a weak monitoring case with nothing to add is never a task on any surface", () => {
    const p = resolvePresentation({
      ...basePresentation,
      strengthOverall: "weak",
      packStatus: "saved_to_shopify",
      submissionState: "not_saved",
    });
    expect(p.strength).toBe("weak");
    expect(p.attention).toBe("none");
    expect(p.needsMerchantAction).toBe(false);
    expect(dashboardBucket(p)).toBe("building_monitoring");
  });
});

// ── Blocking-cause labels (dev report 2026-07-24) ───────────────────────
// "Approval required" is only true for the approval gate. A
// missing-evidence block labels as evidence-needed; billing halts as
// billing-action; the generic fallback is cause-neutral.

import { attentionLabelKey } from "@/lib/disputes/presentation/labels";

describe("Blocking-cause labels", () => {
  it("missing_required_evidence blocks label as evidence-needed, not approval", () => {
    const p = resolvePresentation({
      ...basePresentation,
      needsAttention: true,
      attentionReason: "missing_required_evidence",
    });
    expect(p.attention).toBe("blocking");
    expect(p.blockingReason).toBe("missing_required_evidence");
    expect(attentionLabelKey(p)).toBe(
      "presentation.attentionBlocking.missing_required_evidence",
    );
    expect(listPrimaryState(p).labelKey).toBe(
      "presentation.attentionBlocking.missing_required_evidence",
    );
  });

  it("the review-mode approval gate labels as approval required", () => {
    const p = resolvePresentation({
      ...basePresentation,
      automationMode: "review",
      packStatus: "ready",
      approvedForSaveAt: null,
    });
    expect(p.attention).toBe("blocking");
    expect(p.blockingReason).toBe("approval_gate");
    expect(attentionLabelKey(p)).toBe("presentation.attentionBlocking.approval_gate");
  });

  it("billing halts label as billing action", () => {
    const p = resolvePresentation({
      ...basePresentation,
      needsAttention: true,
      attentionReason: "quota_exceeded",
    });
    expect(p.blockingReason).toBe("quota_exceeded");
    expect(attentionLabelKey(p)).toBe("presentation.attentionBlocking.quota_exceeded");
  });

  it("non-blocking attention keeps the plain attention key", () => {
    const p = resolvePresentation({ ...basePresentation, gorgiasActionableCount: 1 });
    expect(attentionLabelKey(p)).toBe("presentation.attention.requested");
    expect(p.blockingReason).toBe(null);
  });
});
