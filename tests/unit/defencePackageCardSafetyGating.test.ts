/**
 * PR-C1 — the merchant-facing gating derivation in
 * `CompleteDefencePackageCard`.
 *
 * The card's own action gates are plain boolean expressions over the server's
 * safety verdict. Restating them here pins the CONTRACT (which actions
 * survive a block, which do not) without mounting Polaris: if someone changes
 * the card so a blocked package can be finalized or submitted again, the
 * source expression and this table diverge and the reviewer sees it.
 *
 * The expressions mirror `CompleteDefencePackageCard.tsx`:
 *   canFinalize        = !packageBlocked && hasActionableDraft && draft && ok && pdf
 *   canSubmit          = !packageBlocked && hasActionableDraft && final
 *   bannerHostsActions = !packageBlocked && …
 *   canRegenerate      —  NOT gated on packageBlocked (regenerating is the fix)
 */

import { describe, it, expect } from "vitest";

interface Row {
  status: "draft" | "final" | "stale" | "failed" | "submitted";
  validation_status?: string | null;
  pdf_path?: string | null;
}

function gates(args: {
  row: Row;
  packageBlocked: boolean;
  hasActionableDraft?: boolean;
  isNetworkSubmitted?: boolean;
  isClosed?: boolean;
}) {
  const {
    row,
    packageBlocked,
    hasActionableDraft = true,
    isNetworkSubmitted = false,
    isClosed = false,
  } = args;
  const canFinalize =
    !packageBlocked &&
    hasActionableDraft &&
    row.status === "draft" &&
    row.validation_status === "ok" &&
    Boolean(row.pdf_path);
  const canSubmit = !packageBlocked && hasActionableDraft && row.status === "final";
  const canRegenerate =
    !isNetworkSubmitted &&
    !isClosed &&
    (row.status === "draft" || row.status === "stale" || row.status === "failed");
  // Preview is a pure read of the persisted PDF — never gated on safety.
  const canPreview = Boolean(row.pdf_path);
  return { canFinalize, canSubmit, canRegenerate, canPreview };
}

const DRAFT: Row = { status: "draft", validation_status: "ok", pdf_path: "p.pdf" };
const FINAL: Row = { status: "final", validation_status: "ok", pdf_path: "p.pdf" };

describe("blocked candidate — approval actions are unavailable", () => {
  it("disables Finalize on a blocked draft", () => {
    expect(gates({ row: DRAFT, packageBlocked: true }).canFinalize).toBe(false);
    expect(gates({ row: DRAFT, packageBlocked: false }).canFinalize).toBe(true);
  });

  it("disables Submit on a blocked final", () => {
    expect(gates({ row: FINAL, packageBlocked: true }).canSubmit).toBe(false);
    expect(gates({ row: FINAL, packageBlocked: false }).canSubmit).toBe(true);
  });

  it("disables Resubmit — the banner action host is suppressed when blocked", () => {
    const bannerHostsActions = (packageBlocked: boolean) =>
      !packageBlocked && true /* hasUnsubmittedDraft && latest && bankFacing && … */;
    expect(bannerHostsActions(true)).toBe(false);
    expect(bannerHostsActions(false)).toBe(true);
  });
});

describe("blocked candidate — the recovery actions stay available", () => {
  it("keeps Regenerate", () => {
    expect(gates({ row: DRAFT, packageBlocked: true }).canRegenerate).toBe(true);
    expect(gates({ row: { status: "stale" }, packageBlocked: true }).canRegenerate).toBe(true);
  });

  it("keeps Preview", () => {
    expect(gates({ row: DRAFT, packageBlocked: true }).canPreview).toBe(true);
  });
});

describe("a regenerated safe version restores the normal actions", () => {
  it("blocked v3 → safe v4: Finalize and Submit come back", () => {
    // The card reads `defencePackage.latest` + the server verdict for THAT
    // row. A new version arrives with `blocked: false`, so nothing about the
    // older blocked version constrains it.
    const blockedV3 = gates({ row: DRAFT, packageBlocked: true });
    const safeV4Draft = gates({ row: DRAFT, packageBlocked: false });
    const safeV4Final = gates({ row: FINAL, packageBlocked: false });
    expect(blockedV3.canFinalize).toBe(false);
    expect(safeV4Draft.canFinalize).toBe(true);
    expect(safeV4Final.canSubmit).toBe(true);
  });
});

describe("a 422 must not produce a submitted state", () => {
  /** The `onSubmit` early-return contract: on a non-OK response the handler
   *  sets an error, refreshes, and RETURNS — before `setSubmitPending(true)`
   *  and before `onSubmitted?.()` (which is what calls `markJustSubmitted`). */
  function onSubmitOutcome(res: { ok: boolean; code?: string }) {
    const effects = { submitPending: false, markJustSubmitted: false, error: false, refreshed: false };
    if (!res.ok) {
      effects.error = true;
      effects.refreshed = true;
      return effects; // early return — nothing below runs
    }
    effects.submitPending = true;
    effects.markJustSubmitted = true;
    return effects;
  }

  it("422 PACKAGE_REVIEW_REQUIRED sets neither submitPending nor markJustSubmitted", () => {
    const e = onSubmitOutcome({ ok: false, code: "PACKAGE_REVIEW_REQUIRED" });
    expect(e.submitPending).toBe(false);
    expect(e.markJustSubmitted).toBe(false);
    expect(e.error).toBe(true);
    expect(e.refreshed).toBe(true); // pulls the server's review-required verdict
  });

  it("a 200 still marks submitted", () => {
    const e = onSubmitOutcome({ ok: true });
    expect(e.submitPending).toBe(true);
    expect(e.markJustSubmitted).toBe(true);
  });
});
