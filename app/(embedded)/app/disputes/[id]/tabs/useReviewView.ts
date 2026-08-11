/**
 * Pure derivation hook for the ReviewSubmitTab.
 *
 * Post-retirement shape (2026-05-16): the view-model carries only what
 * the merchant needs to confirm the submission state and trigger the
 * CTA. The defence-package PDF + the HTML mirror inside
 * `CompleteDefencePackageCard` already show everything else; the
 * separate "Exact data sent" card was removed in the same pass.
 */

"use client";

import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import type { I18nToken } from "@/lib/i18n/token";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── View-model types ── */

/**
 * `not_assessed` is a real state, not an error and not a loading spinner.
 *
 * It is what the tab shows when the server could give no current assessment.
 * Without it the only options were `ready_to_submit` — which offers a submit
 * button for a case nothing has judged — or nothing at all, which reads as a
 * broken page.
 */
export type ReviewState = "submitted" | "ready_to_submit" | "not_assessed";

export interface ReviewViewModel {
  state: ReviewState;
  submittedAt: string | null;
  shopifyAdminUrl: string | null;
  /** Title + body tokens for the `not_assessed` state. Null otherwise. */
  notAssessed: { titleToken: I18nToken; bodyToken: I18nToken } | null;
  cta: {
    label: string;
    severity: "info" | "warning" | "critical";
    enabled: boolean;
    requiresOverride: boolean;
  } | null;
}

/* ── Hook ── */

export function useReviewView(workspace: Workspace): ReviewViewModel {
  const { data, derived } = workspace;

  if (!data) {
    return {
      state: "not_assessed",
      submittedAt: null,
      shopifyAdminUrl: null,
      notAssessed: {
        titleToken: derived.assessment.titleToken,
        bodyToken: derived.assessment.bodyToken,
      },
      cta: null,
    };
  }

  /* ── NO ASSESSMENT, NO SUBMIT ACTION ──────────────────────────────
   *
   * Checked before anything reads `derived.readiness`, and that ordering is
   * the whole point. With no assessment the readiness sentinel is `"blocked"`,
   * which sets `requiresOverride` below and relabels the CTA "Save anyway" —
   * an invitation to accept a risk the product has not measured, on a case it
   * has not judged. The empty sentinel is not permission to override; it is
   * the absence of the thing an override would be overriding.
   */
  if (!derived.assessment.mayOfferFilingAction && !derived.isReadOnly) {
    return {
      state: "not_assessed",
      submittedAt: null,
      shopifyAdminUrl: getShopifyDisputeUrl(
        data.dispute.shopDomain,
        data.dispute.disputeEvidenceGid,
      ),
      notAssessed: {
        titleToken: derived.assessment.titleToken,
        bodyToken: derived.assessment.bodyToken,
      },
      cta: null,
    };
  }

  const isSubmitted = derived.isReadOnly;
  const state: ReviewState = isSubmitted ? "submitted" : "ready_to_submit";
  // Prefer the DB timestamp; fall back to `now` when the merchant just
  // clicked Submit and the save-to-shopify job hasn't stamped
  // `saved_to_shopify_at` yet. Without the fallback, the card stays in
  // "Submit to Shopify" layout even after a successful click because
  // `isSubmittedToBank` is purely driven by `submittedToShopifyAt`.
  // The 4s workspace poll replaces this placeholder with the real
  // timestamp once the job persists.
  const submittedAt =
    data.pack?.savedToShopifyAt ??
    (isSubmitted ? new Date().toISOString() : null);
  const shopifyAdminUrl: string | null = getShopifyDisputeUrl(
    data.dispute.shopDomain,
    data.dispute.disputeEvidenceGid,
  );

  const requiresOverride =
    derived.readiness === "blocked" ||
    derived.readiness === "ready_with_warnings";

  const cta = isSubmitted
    ? null
    : {
        label: requiresOverride ? "Save anyway" : derived.nextAction.label,
        severity: derived.nextAction.severity,
        enabled: !derived.isBuilding && !derived.isFailed,
        requiresOverride,
      };

  return {
    state,
    submittedAt,
    shopifyAdminUrl,
    notAssessed: null,
    cta,
  };
}
