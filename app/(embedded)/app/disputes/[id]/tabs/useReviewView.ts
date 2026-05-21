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

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── View-model types ── */

export type ReviewState = "submitted" | "ready_to_submit";

export interface ReviewViewModel {
  state: ReviewState;
  submittedAt: string | null;
  shopifyAdminUrl: string | null;
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
      state: "ready_to_submit",
      submittedAt: null,
      shopifyAdminUrl: null,
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
        label: requiresOverride ? "Submit anyway" : derived.nextAction.label,
        severity: derived.nextAction.severity,
        enabled: !derived.isBuilding && !derived.isFailed,
        requiresOverride,
      };

  return {
    state,
    submittedAt,
    shopifyAdminUrl,
    cta,
  };
}
