/**
 * PR-C1 — the REAL action-gating and submit-response derivation.
 *
 * This imports the exact functions `CompleteDefencePackageCard` calls
 * (`deriveDefencePackageActionState`, `deriveSubmitEffects`). The previous
 * version of this file re-implemented those expressions in a local `gates()`
 * helper the component never imported, so it could stay green while the card
 * regressed. Testing the shipped code is the point.
 *
 * Server-side enforcement is proven separately by the route tests; this file
 * proves the merchant is never SHOWN an action the server will refuse.
 */

import { describe, expect, it } from "vitest";
import {
  deriveDefencePackageActionState,
  deriveSubmitEffects,
  type ActionStateInput,
} from "@/app/(embedded)/app/disputes/[id]/tabs/sections/defencePackageActionState";

const BASE: ActionStateInput = {
  rowStatus: "draft",
  rowValidationStatus: "ok",
  rowPdfPath: "p.pdf",
  latestStatus: "draft",
  rowPromptVersion: 10,
  currentPromptVersion: 10,
  hasActionableDraft: true,
  hasUnsubmittedDraft: true,
  hasLatest: true,
  hasBankFacing: true,
  isNetworkSubmitted: false,
  isClosed: false,
  submitPending: false,
  safety: { blocked: false, reasons: [], message: "" },
};

const blocked = (over: Partial<ActionStateInput> = {}) =>
  deriveDefencePackageActionState({
    ...BASE,
    safety: {
      blocked: true,
      reasons: ["affirmative_address_delivery_claim"],
      message: "…regenerate…",
    },
    ...over,
  });

const safe = (over: Partial<ActionStateInput> = {}) =>
  deriveDefencePackageActionState({ ...BASE, ...over });

describe("blocked candidate — approval actions are unavailable", () => {
  it("Finalize is disabled on a blocked draft", () => {
    expect(blocked({ rowStatus: "draft" }).canFinalize).toBe(false);
    expect(safe({ rowStatus: "draft" }).canFinalize).toBe(true);
  });

  it("Submit is disabled on a blocked final", () => {
    expect(blocked({ rowStatus: "final" }).canSubmit).toBe(false);
    expect(safe({ rowStatus: "final" }).canSubmit).toBe(true);
  });

  it("Resubmit is unavailable — the banner that hosts it is suppressed", () => {
    expect(blocked().bannerHostsActions).toBe(false);
    expect(safe().bannerHostsActions).toBe(true);
  });

  it("the review-required banner renders", () => {
    expect(blocked().showReviewRequired).toBe(true);
    expect(safe().showReviewRequired).toBe(false);
  });

  it("blocks for EVERY reason code the server can return", () => {
    for (const reason of [
      "retired_delivery_fact",
      "affirmative_address_delivery_claim",
      "ambiguous_address_delivery_claim",
      "unreadable_facts_json",
      "unreadable_narrative_json",
      "no_defence_package",
      "candidate_not_current",
      "preflight_error",
    ]) {
      const st = deriveDefencePackageActionState({
        ...BASE,
        safety: { blocked: true, reasons: [reason], message: "m" },
      });
      expect(st.canFinalize, reason).toBe(false);
      expect(st.canSubmit, reason).toBe(false);
      expect(st.bannerHostsActions, reason).toBe(false);
    }
  });
});

describe("blocked candidate — the recovery actions stay available", () => {
  it("Regenerate stays available on draft / stale / failed", () => {
    for (const rowStatus of ["draft", "stale", "failed"]) {
      expect(blocked({ rowStatus }).canRegenerate, rowStatus).toBe(true);
    }
  });

  it("Regenerate is still hard-locked once the network has the evidence", () => {
    expect(blocked({ isNetworkSubmitted: true }).canRegenerate).toBe(false);
    expect(blocked({ isClosed: true }).canRegenerate).toBe(false);
  });
});

describe("a regenerated safe current version restores the actions", () => {
  it("blocked v3 → safe v4", () => {
    // The card reads `latest` plus the server verdict FOR THAT ROW, so nothing
    // about the older blocked version constrains the new one.
    expect(blocked({ rowStatus: "draft" }).canFinalize).toBe(false);
    expect(safe({ rowStatus: "draft" }).canFinalize).toBe(true);
    expect(safe({ rowStatus: "final" }).canSubmit).toBe(true);
    expect(safe().bannerHostsActions).toBe(true);
  });
});

describe("submit-response handling", () => {
  const FALLBACK = "Submit failed (500)";

  it("422 PACKAGE_REVIEW_REQUIRED sets neither submitPending nor markJustSubmitted", () => {
    const e = deriveSubmitEffects(
      {
        ok: false,
        status: 422,
        body: { code: "PACKAGE_REVIEW_REQUIRED", message: "Regenerate the package." },
      },
      FALLBACK,
    );
    expect(e.markPending).toBe(false);
    expect(e.notifySubmitted).toBe(false);
    expect(e.error).toBe("Regenerate the package.");
    // Refreshing is what pulls the server's review-required verdict in.
    expect(e.refresh).toBe(true);
  });

  it("503 PACKAGE_CHECK_UNAVAILABLE also shows no submitted state", () => {
    const e = deriveSubmitEffects(
      { ok: false, status: 503, body: { code: "PACKAGE_CHECK_UNAVAILABLE", message: "Try again." } },
      FALLBACK,
    );
    expect(e.markPending).toBe(false);
    expect(e.notifySubmitted).toBe(false);
    expect(e.error).toBe("Try again.");
  });

  it("any other refusal is equally safe, and keeps the structured error", () => {
    const e = deriveSubmitEffects(
      { ok: false, status: 409, body: { error: "Cannot submit a package in status=draft" } },
      FALLBACK,
    );
    expect(e.markPending).toBe(false);
    expect(e.notifySubmitted).toBe(false);
    expect(e.error).toBe("Cannot submit a package in status=draft");
  });

  it("an unparseable refusal body falls back, still without a submitted state", () => {
    const e = deriveSubmitEffects({ ok: false, status: 500, body: null }, FALLBACK);
    expect(e.markPending).toBe(false);
    expect(e.notifySubmitted).toBe(false);
    expect(e.error).toBe(FALLBACK);
  });

  it("a 200 still marks submitted", () => {
    const e = deriveSubmitEffects({ ok: true, status: 200, body: {} }, FALLBACK);
    expect(e.markPending).toBe(true);
    expect(e.notifySubmitted).toBe(true);
    expect(e.error).toBeNull();
  });
});
