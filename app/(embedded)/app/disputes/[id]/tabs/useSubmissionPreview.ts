/**
 * useSubmissionPreview — fetches the live submission-preview for a pack.
 *
 * Calls `GET /api/packs/[packId]/submission-preview?format=raw`, which
 * runs the same `composeShopifyMutationPayload` builder as the actual
 * save job. The raw `mutationPayload` is the byte-for-byte input to the
 * `disputeEvidenceUpdate` GraphQL mutation (placeholder URLs/GIDs in
 * the preview, real ones at submit time).
 *
 * This is the single source of truth for *what will be sent to Shopify*
 * on the Review & Submit tab.
 */

"use client";

import { useEffect, useState } from "react";

export interface SubmissionPreviewField {
  shopifyFieldName: string;
  shopifyFieldLabel: string;
  content: string;
  contentPreview: string;
  source: string;
  included: boolean;
}

/** Subset of `DisputeEvidenceUpdateInput` we surface in the UI. The
 *  GraphQL input has more keys; we type only what the merchant view
 *  reads, plus a passthrough for forward-compat. */
export interface SubmissionMutationPayload {
  accessActivityLog?: string;
  cancellationPolicyDisclosure?: string;
  refundPolicyDisclosure?: string;
  refundRefusalExplanation?: string;
  cancellationRebuttal?: string;
  uncategorizedText?: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmailAddress?: string;
  shippingDocumentationFile?: { id: string };
  customerCommunicationFile?: { id: string };
  serviceDocumentationFile?: { id: string };
  refundPolicyFile?: { id: string };
  cancellationPolicyFile?: { id: string };
  uncategorizedFile?: { id: string };
  [key: string]: unknown;
}

export interface SubmissionPreview {
  fields: SubmissionPreviewField[];
  mutationPayload: SubmissionMutationPayload;
}

export interface SubmissionPreviewState {
  preview: SubmissionPreview | null;
  loading: boolean;
  error: string | null;
}

export function useSubmissionPreview(
  packId: string | null | undefined,
): SubmissionPreviewState {
  const [state, setState] = useState<SubmissionPreviewState>({
    preview: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!packId) {
      setState({ preview: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch(`/api/packs/${packId}/submission-preview?format=raw`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as SubmissionPreview;
      })
      .then((preview) => {
        if (cancelled) return;
        setState({ preview, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setState({ preview: null, loading: false, error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [packId]);

  return state;
}
