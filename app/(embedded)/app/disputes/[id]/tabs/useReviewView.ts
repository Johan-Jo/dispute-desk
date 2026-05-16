/**
 * Pure derivation hook for the ReviewSubmitTab.
 *
 * Post-retirement shape (2026-05-16): the view-model carries only what
 * the merchant needs to confirm the four-field Shopify submission —
 * customer info fields + the defence-package PDF attachment row.
 * The legacy rebuttal text + six-group fields + "not submitted"
 * transparency rows + bankRebuttalText / derivedFrom / rebuttalOutdated
 * fields were all deleted with the text-rebuttal engine.
 */

"use client";

import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import type {
  SubmissionPreview,
  SubmissionMutationPayload,
} from "./useSubmissionPreview";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── View-model types ── */

export type ReviewState = "submitted" | "ready_to_submit";

export interface DataSentCustomerField {
  shopifyFieldName: "customerFirstName" | "customerLastName" | "customerEmailAddress";
  label: string;
  content: string;
}

export interface DataSentPdfAttachment {
  fileGid: string | null;
  /** Display filename when known. The actual filename is set on
   *  upload (`defence-package-vN.pdf`). */
  fileName: string;
}

export interface DataSentPayload {
  customer: DataSentCustomerField[];
  pdf: DataSentPdfAttachment | null;
}

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
  payload: DataSentPayload | null;
  payloadLoading: boolean;
}

/* ── Hook ── */

export function useReviewView(
  workspace: Workspace,
  submissionPreview?: { preview: SubmissionPreview | null; loading: boolean },
): ReviewViewModel {
  const { data, derived } = workspace;
  const previewLoading = submissionPreview?.loading ?? false;
  const livePayload: SubmissionMutationPayload | null =
    submissionPreview?.preview?.mutationPayload ?? null;

  if (!data) {
    return {
      state: "ready_to_submit",
      submittedAt: null,
      shopifyAdminUrl: null,
      cta: null,
      payload: null,
      payloadLoading: previewLoading,
    };
  }

  const isSubmitted = derived.isReadOnly;
  const state: ReviewState = isSubmitted ? "submitted" : "ready_to_submit";
  const submittedAt = data.pack?.savedToShopifyAt ?? null;
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

  /* ── Exact data sent payload ── */

  let payload: DataSentPayload | null = null;
  if (livePayload) {
    const customer: DataSentCustomerField[] = [];
    if (livePayload.customerFirstName) {
      customer.push({
        shopifyFieldName: "customerFirstName",
        label: "Customer first name",
        content: livePayload.customerFirstName,
      });
    }
    if (livePayload.customerLastName) {
      customer.push({
        shopifyFieldName: "customerLastName",
        label: "Customer last name",
        content: livePayload.customerLastName,
      });
    }
    if (livePayload.customerEmailAddress) {
      customer.push({
        shopifyFieldName: "customerEmailAddress",
        label: "Customer email",
        content: livePayload.customerEmailAddress,
      });
    }

    const pdf: DataSentPdfAttachment | null = livePayload.uncategorizedFile
      ? {
          fileGid: livePayload.uncategorizedFile.id ?? null,
          fileName: "Complete Defence Package PDF",
        }
      : null;

    payload = customer.length > 0 || pdf ? { customer, pdf } : null;
  }

  return {
    state,
    submittedAt,
    shopifyAdminUrl,
    cta,
    payload,
    payloadLoading: previewLoading,
  };
}
