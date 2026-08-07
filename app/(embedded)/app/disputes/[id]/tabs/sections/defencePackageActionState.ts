/**
 * The action-gating and submit-response derivation for
 * `CompleteDefencePackageCard`.
 *
 * WHY THIS IS A MODULE AND NOT INLINE. The first version of the PR-C1 UI test
 * re-implemented these expressions in the test file. The component did not
 * import that copy, so the test could stay green while the real card
 * regressed — a test of a test. These functions are the ones the component
 * actually calls, so the test below them is a test of shipped behaviour.
 *
 * Pure and framework-free on purpose: no React, no Polaris, no fetch.
 */

export interface DefencePackageSafety {
  blocked: boolean;
  reasons: string[];
  message: string;
}

export interface ActionStateInput {
  /** The row currently displayed (`latest`, or `bankFacing` when submitted). */
  rowStatus: "draft" | "final" | "stale" | "failed" | "submitted" | string;
  rowValidationStatus: string | null | undefined;
  rowPdfPath: string | null | undefined;
  /** `latest.status`, used for the stale-regenerate rule. */
  latestStatus?: string | null;
  rowPromptVersion?: number | null;
  currentPromptVersion?: number | null;
  /** `!isSubmittedToBank || hasUnsubmittedDraft` — computed by the card. */
  hasActionableDraft: boolean;
  hasUnsubmittedDraft: boolean;
  hasLatest: boolean;
  hasBankFacing: boolean;
  isNetworkSubmitted: boolean;
  isClosed: boolean;
  submitPending: boolean;
  /** The server's PR-C1 verdict for the latest candidate. */
  safety?: DefencePackageSafety;
}

export interface ActionState {
  /** PR-C1: the server refused this candidate; approval actions are gone. */
  packageBlocked: boolean;
  canFinalize: boolean;
  canSubmit: boolean;
  canRegenerate: boolean;
  /** The banner that hosts Approve / Resubmit / More actions. */
  bannerHostsActions: boolean;
  /** Render the review-required banner. */
  showReviewRequired: boolean;
}

/**
 * Every approval action is gated on the SERVER's verdict, so the button state
 * and the endpoint agree by construction: `/finalize`, `/submit`,
 * `/approve` and `/save-to-shopify` all return 422 for a blocked candidate.
 * Offering a button that is guaranteed to 422 is how the merchant ended up
 * looking at a submitted state for a package that was never filed.
 *
 * Regenerate and Preview are deliberately NOT gated: regenerating is the fix,
 * and previewing a persisted PDF changes nothing.
 */
export function deriveDefencePackageActionState(input: ActionStateInput): ActionState {
  const packageBlocked = input.safety?.blocked === true;

  const canFinalize =
    !packageBlocked &&
    input.hasActionableDraft &&
    input.rowStatus === "draft" &&
    input.rowValidationStatus === "ok" &&
    Boolean(input.rowPdfPath);

  const canSubmit =
    !packageBlocked && input.hasActionableDraft && input.rowStatus === "final";

  const submittedRowIsStale =
    input.rowStatus === "submitted" &&
    ((input.latestStatus ?? null) === "stale" ||
      (typeof input.rowPromptVersion === "number" &&
        typeof input.currentPromptVersion === "number" &&
        input.rowPromptVersion < input.currentPromptVersion));

  const canRegenerate =
    !input.isNetworkSubmitted &&
    !input.isClosed &&
    (input.rowStatus === "draft" ||
      input.rowStatus === "stale" ||
      input.rowStatus === "failed" ||
      submittedRowIsStale);

  const bannerHostsActions =
    !packageBlocked &&
    input.hasUnsubmittedDraft &&
    input.hasLatest &&
    input.hasBankFacing &&
    !input.isNetworkSubmitted &&
    !input.isClosed &&
    !input.submitPending;

  return {
    packageBlocked,
    canFinalize,
    canSubmit,
    canRegenerate,
    bannerHostsActions,
    showReviewRequired: packageBlocked,
  };
}

/* ── Submit-response handling ─────────────────────────────────────────── */

export interface SubmitResponseLike {
  ok: boolean;
  status: number;
  body?: { error?: unknown; code?: unknown; message?: unknown } | null;
}

export interface SubmitEffects {
  /** Set `submitPending` and flip the card into the saving layout. */
  markPending: boolean;
  /** Call `onSubmitted?.()` — the parent's `markJustSubmitted`. */
  notifySubmitted: boolean;
  /** Re-fetch the workspace so the server verdict lands. */
  refresh: boolean;
  /** Merchant-facing error text, when the submit was refused. */
  error: string | null;
}

/**
 * What `onSubmit` must do with a response.
 *
 * A refusal returns BEFORE `markPending` / `notifySubmitted`, so a 422
 * `PACKAGE_REVIEW_REQUIRED` — or any other non-OK status — can never show a
 * submitted state. It still refreshes, which is what pulls the server's
 * review-required verdict into the card and disables the buttons.
 */
export function deriveSubmitEffects(
  res: SubmitResponseLike,
  fallbackError: string,
): SubmitEffects {
  if (!res.ok) {
    const body = res.body ?? {};
    const message =
      (body.code === "PACKAGE_REVIEW_REQUIRED" || body.code === "PACKAGE_CHECK_UNAVAILABLE") &&
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : fallbackError;
    return { markPending: false, notifySubmitted: false, refresh: true, error: message };
  }
  return { markPending: true, notifySubmitted: true, refresh: true, error: null };
}
