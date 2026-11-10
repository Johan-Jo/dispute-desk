/**
 * Track S — the save lifecycle tells the truth.
 *
 * `saving` is its own queued lifecycle (not "building evidence"),
 * `save_failed` is its own lifecycle (not "pack prepared"), a queued save is
 * also derivable from an active `save_to_shopify` job (the deadline cron's RPC
 * never touches pack status), and a pack the OLD enqueue stamped
 * `saved_to_shopify` while `submission_state` records no save is not a save.
 */
import { describe, expect, it } from "vitest";
import {
  dashboardBucket,
  resolveLifecycle,
  resolvePresentation,
  resolveSaveAttempt,
  type LifecycleInput,
  type PresentationInput,
} from "@/lib/disputes/presentation";
import { LIFECYCLE_CHIP } from "@/lib/disputes/presentation/uiTokens";
import { lifecycleLabelKey, listPrimaryState } from "@/lib/disputes/presentation/labels";
import { effectiveReviewDecision } from "@/lib/disputes/presentation/reviewDecision";

const base: LifecycleInput = {
  finalOutcome: null,
  closedAt: null,
  submissionState: "not_saved",
  normalizedStatus: "in_progress",
  packStatus: null,
};

describe("resolveLifecycle — save rungs", () => {
  it("pack status `saving` is save_queued, not building_evidence", () => {
    expect(resolveLifecycle({ ...base, packStatus: "saving" })).toBe("save_queued");
  });

  it("pack status `save_failed` is save_failed, not pack_prepared", () => {
    expect(resolveLifecycle({ ...base, packStatus: "save_failed" })).toBe("save_failed");
  });

  it("save_failed is not softened by artifactPrepared", () => {
    expect(
      resolveLifecycle({ ...base, packStatus: "save_failed", artifactPrepared: false }),
    ).toBe("save_failed");
  });

  it("an active save job makes a `ready` pack save_queued (deadline-cron RPC path)", () => {
    expect(resolveLifecycle({ ...base, packStatus: "ready", saveJobStatus: "queued" })).toBe(
      "save_queued",
    );
    expect(resolveLifecycle({ ...base, packStatus: "ready", saveJobStatus: "running" })).toBe(
      "save_queued",
    );
  });

  it("an active save job outranks a save_failed pack (a retry is in flight)", () => {
    expect(
      resolveLifecycle({ ...base, packStatus: "save_failed", saveJobStatus: "queued" }),
    ).toBe("save_queued");
  });

  it("no job read (null/undefined) changes nothing", () => {
    expect(resolveLifecycle({ ...base, packStatus: "ready", saveJobStatus: null })).toBe(
      "pack_prepared",
    );
    expect(resolveLifecycle({ ...base, packStatus: "ready" })).toBe("pack_prepared");
  });

  it("a recorded save wins over everything: submission_state saved_to_shopify", () => {
    expect(
      resolveLifecycle({
        ...base,
        submissionState: "saved_to_shopify",
        packStatus: "save_failed",
        saveJobStatus: "queued",
      }),
    ).toBe("saved_to_shopify");
  });

  it("legacy: pack stamped saved_to_shopify + submission_state not_saved is NOT saved", () => {
    // Pre-Track-S enqueue stamp (#23750). It resolves to monitoring — the
    // pre-existing rung-6 behaviour — never `saved_to_shopify`; the backfill
    // (scripts/sql/save-state-truth-backfill.sql) relabels these packs.
    const lc = resolveLifecycle({ ...base, packStatus: "saved_to_shopify" });
    expect(lc).not.toBe("saved_to_shopify");
    expect(lc).toBe("monitoring");
  });
});

describe("resolveSaveAttempt", () => {
  it("running / queued jobs outrank settled facts", () => {
    expect(
      resolveSaveAttempt({ packStatus: "save_failed", submissionState: "not_saved", activeJobStatus: "running" }),
    ).toBe("running");
    expect(
      resolveSaveAttempt({ packStatus: "ready", submissionState: "not_saved", activeJobStatus: "queued" }),
    ).toBe("queued");
    expect(
      resolveSaveAttempt({ packStatus: "ready", submissionState: "not_saved", activeJobStatus: "pending" }),
    ).toBe("queued");
  });

  it("saved only on the record, never on the pack stamp alone", () => {
    expect(
      resolveSaveAttempt({ packStatus: "saved_to_shopify_verified", submissionState: "saved_to_shopify" }),
    ).toBe("saved");
    expect(
      resolveSaveAttempt({ packStatus: "saved_to_shopify", submissionState: "not_saved" }),
    ).toBe("stamped_unconfirmed");
    expect(
      resolveSaveAttempt({ packStatus: "saved_to_shopify_unverified", submissionState: null }),
    ).toBe("stamped_unconfirmed");
  });

  it("saving → queued, save_failed → failed, ready/none → none", () => {
    expect(resolveSaveAttempt({ packStatus: "saving", submissionState: "not_saved" })).toBe("queued");
    expect(resolveSaveAttempt({ packStatus: "save_failed", submissionState: "not_saved" })).toBe("failed");
    expect(resolveSaveAttempt({ packStatus: "ready", submissionState: "not_saved" })).toBe("none");
    expect(resolveSaveAttempt({ packStatus: null, submissionState: null })).toBe("none");
  });
});

describe("readers of the new lifecycle values", () => {
  const presentationInput = (over: Partial<PresentationInput>): PresentationInput => ({
    ...base,
    strengthOverall: null,
    attentionReason: null,
    needsAttention: false,
    integrationReconnectRequired: false,
    gorgiasActionableCount: 0,
    automationMode: "auto",
    approvedForSaveAt: null,
    concreteContribution: null,
    gorgiasEvidenceStale: false,
    ...over,
  });

  it("every lifecycle has a chip token (no fall-through)", () => {
    expect(LIFECYCLE_CHIP.save_queued).toBeDefined();
    expect(LIFECYCLE_CHIP.save_failed).toBeDefined();
  });

  it("labels resolve to presentation.lifecycle.<value>", () => {
    expect(lifecycleLabelKey({ lifecycle: "save_queued" })).toBe("presentation.lifecycle.save_queued");
    expect(
      listPrimaryState({ lifecycle: "save_failed", attention: "none", blockingReason: null }),
    ).toEqual({
      labelKey: "presentation.lifecycle.save_failed",
      subKey: "presentation.lifecycleSub.save_failed",
    });
  });

  it("both are pre-save rungs: a recorded decision stays pending", () => {
    expect(effectiveReviewDecision("save_queued", "approved")).toBe("approved");
    expect(effectiveReviewDecision("save_failed", "approved")).toBe("approved");
  });

  it("buckets: still building_monitoring (pre-transmission, no merchant task)", () => {
    for (const packStatus of ["saving", "save_failed"]) {
      const p = resolvePresentation(presentationInput({ packStatus }));
      expect(dashboardBucket(p)).toBe("building_monitoring");
    }
  });

  it("save_failed pack is an internal issue, not a merchant task", () => {
    const p = resolvePresentation(presentationInput({ packStatus: "save_failed" }));
    expect(p.lifecycle).toBe("save_failed");
    expect(p.internalIssue).toBe(true);
    expect(p.needsMerchantAction).toBe(false);
  });

  it("submission_failed attention reason is internal, not a merchant task", () => {
    const p = resolvePresentation(
      presentationInput({
        packStatus: "save_failed",
        attentionReason: "submission_failed",
        needsAttention: true,
      }),
    );
    expect(p.needsMerchantAction).toBe(false);
  });
});
