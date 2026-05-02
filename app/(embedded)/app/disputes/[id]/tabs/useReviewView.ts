/**
 * Pure derivation hook for the ReviewSubmitTab four-section IA.
 *
 * NO fetching, NO state, NO API calls. Reads from the existing workspace
 * shape and returns a typed view-model bucketed into:
 *   1. Submission status
 *   2. Exact data sent to Shopify    (grouped into 5 readable buckets)
 *   3. Not submitted (transparency)
 *   4. Final defense statement
 *
 * Field content is NEVER transformed — `submissionFields` values are
 * passed through unchanged, only routed to display groups. The payload
 * the bank sees is identical pre- and post-grouping.
 */

"use client";

import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import type {
  SubmissionField,
  WorkspaceAttachment,
} from "../workspace-components/types";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── View-model types ── */

export type ReviewState = "submitted" | "ready_to_submit";

export type DataSentGroupKey =
  | "orderDetails"
  | "paymentVerification"
  | "customerActivity"
  | "policies"
  | "additionalEvidence";

export interface DataSentField {
  shopifyFieldName: string;
  label: string;
  content: string;
  source: string;
}

export interface DataSentAttachment {
  id: string;
  fileName: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
}

export interface DataSentGroup {
  key: DataSentGroupKey;
  fields: DataSentField[];
  attachments: DataSentAttachment[];
}

export interface NotSubmittedRowViewModel {
  id: string;
  title: string;
  explanation: string;
  reason: NotSubmittedReason;
}

export type NotSubmittedReason =
  | "avoid_weakening"
  | "gateway_gated"
  | "merchant_waived"
  | "write_only";

export interface ReviewViewModel {
  state: ReviewState;
  submittedAt: string | null;
  shopifyAdminUrl: string | null;
  /** When non-null, the merchant has work to do. The CTA copy + which
   *  buttons appear are governed by the existing nextAction +
   *  readiness pipeline; this hook surfaces them but never reassigns
   *  which CTA fires for which gate state.
   *
   *  `requiresOverride` is true when readiness blocks a normal submit
   *  (blocked / weak-with-warnings). The parent must route the click
   *  through an override modal that captures a reason — the merchant
   *  is never blocked outright, but the path requires explicit intent.
   */
  cta: {
    label: string;
    severity: "info" | "warning" | "critical";
    enabled: boolean;
    requiresOverride: boolean;
  } | null;
  /** Five-bucket grouped payload. `null` when no submissionFields are
   *  present (the unsubmitted-empty state). NEVER a loading skeleton. */
  payload: DataSentGroup[] | null;
  notSubmitted: NotSubmittedRowViewModel[];
  bankRebuttalText: string | null;
  derivedFrom: string[];
  /** True when the rebuttal text was generated against an older pack
   *  snapshot. The Final-defense card surfaces a Regenerate button so
   *  the merchant can refresh the statement to match the current pack. */
  rebuttalOutdated: boolean;
}

/* ── Group routing ──
 *
 * Maps each Shopify evidence field name to one of the five fixed
 * presentational groups. Field content is unchanged byte-for-byte;
 * this map only decides which header it sits under in the merchant
 * view. A field not in this map falls through to additionalEvidence
 * (the catch-all) — the same bucket Shopify itself uses for its
 * `uncategorizedText` field.
 */

const GROUP_BY_FIELD: Record<string, DataSentGroupKey> = {
  // Order details
  accessActivityLog: "orderDetails",

  // Customer activity (fulfillment + carrier evidence)
  shippingDocumentation: "customerActivity",
  shippingDocumentationFile: "customerActivity",

  // Policies (4 dedicated Shopify policy/rebuttal fields)
  refundPolicyDisclosure: "policies",
  cancellationPolicyDisclosure: "policies",
  refundRefusalExplanation: "policies",
  cancellationRebuttal: "policies",

  // Additional evidence (catch-all; matches Shopify's uncategorizedText
  // semantics — this is where customer comms + free-text evidence land)
  uncategorizedText: "additionalEvidence",
};

const GROUP_ORDER: DataSentGroupKey[] = [
  "orderDetails",
  "paymentVerification",
  "customerActivity",
  "policies",
  "additionalEvidence",
];

function groupForField(field: SubmissionField): DataSentGroupKey {
  return GROUP_BY_FIELD[field.shopifyFieldName] ?? "additionalEvidence";
}

/* ── Hook ── */

export function useReviewView(workspace: Workspace): ReviewViewModel {
  const { data, derived, clientState } = workspace;

  if (!data) {
    return {
      state: "ready_to_submit",
      submittedAt: null,
      shopifyAdminUrl: null,
      cta: null,
      payload: null,
      notSubmitted: [],
      bankRebuttalText: null,
      derivedFrom: [],
      rebuttalOutdated: false,
    };
  }

  const isSubmitted = derived.isReadOnly;
  const state: ReviewState = isSubmitted ? "submitted" : "ready_to_submit";

  // ── Submission status ──
  const submittedAt = data.pack?.savedToShopifyAt ?? null;

  // Shopify Admin dispute URL — built from the same helper used by
  // the dispute-detail header. Returns null when the evidence GID
  // hasn't been issued yet (pre-sync or freshly-opened dispute).
  const shopifyAdminUrl: string | null = getShopifyDisputeUrl(
    data.dispute.shopDomain,
    data.dispute.disputeEvidenceGid,
  );

  // CTA stays enabled in blocked / ready_with_warnings states so the
  // merchant always has a path forward — but the parent routes the
  // click through an override modal in those cases. `requiresOverride`
  // is the flag the parent reads.
  const requiresOverride =
    derived.readiness === "blocked" ||
    derived.readiness === "ready_with_warnings";
  const cta = isSubmitted
    ? null
    : {
        label: requiresOverride ? "Submit anyway" : derived.nextAction.label,
        severity: derived.nextAction.severity,
        // Disabled only when the system itself can't accept a submit
        // attempt (build in flight or failed). Readiness alone never
        // disables the button — that would block the merchant outright.
        enabled: !derived.isBuilding && !derived.isFailed,
        requiresOverride,
      };

  // ── Exact data sent to Shopify ──
  const submissionFields = data.submissionFields ?? [];
  // Only included fields appear in the bank-visible payload. Excluded
  // ones land in §3 (Not submitted).
  const includedFields = submissionFields.filter((f) => f.included);

  // The five-group bucket list. Empty groups are returned with
  // empty arrays; the section component is responsible for hiding
  // groups whose `fields` and `attachments` are both empty.
  const groups: DataSentGroup[] = GROUP_ORDER.map((key) => ({
    key,
    fields: [],
    attachments: [],
  }));
  const groupIndex: Record<DataSentGroupKey, DataSentGroup> = {
    orderDetails: groups[0],
    paymentVerification: groups[1],
    customerActivity: groups[2],
    policies: groups[3],
    additionalEvidence: groups[4],
  };

  for (const f of includedFields) {
    const bucket = groupIndex[groupForField(f)];
    bucket.fields.push({
      shopifyFieldName: f.shopifyFieldName,
      label: f.shopifyFieldLabel,
      content: f.content,
      source: f.source,
    });
  }

  // Attachments → additionalEvidence by default. The plan groups
  // uploaded files under "Additional evidence"; finer routing (e.g.,
  // a delivery photo into customerActivity) requires per-file
  // metadata that is not yet in WorkspaceAttachment.
  const attachments: WorkspaceAttachment[] = data.attachments ?? [];
  for (const att of attachments) {
    groupIndex.additionalEvidence.attachments.push({
      id: att.id,
      fileName: att.fileName,
      sizeBytes: att.sizeBytes,
      mimeType: att.mimeType,
    });
  }

  // Hide empty groups in the view-model so consumers can iterate
  // unconditionally. The component still renders nothing for an
  // absent group, but stripping at the hook layer makes
  // verification-step #7 ("hide-when-empty") a one-liner assertion.
  const populatedGroups = groups.filter(
    (g) => g.fields.length > 0 || g.attachments.length > 0,
  );

  // payload: null when no submissionFields exist at all (pre-build /
  // empty pack). The component shows the explicit empty-state copy
  // in that case — never a skeleton.
  const payload: DataSentGroup[] | null =
    populatedGroups.length === 0 ? null : populatedGroups;

  // ── Not submitted (transparency) ──
  const notSubmitted: NotSubmittedRowViewModel[] = [];
  for (const f of submissionFields) {
    if (f.included) continue;
    notSubmitted.push({
      id: `field:${f.shopifyFieldName}`,
      title: f.shopifyFieldLabel,
      explanation: f.content,
      reason: "avoid_weakening",
    });
  }

  const excludedFields = clientState?.excludedFields ?? new Set<string>();
  for (const fieldName of excludedFields) {
    // Avoid double-listing if it's already in the submissionFields-
    // not-included list above.
    if (notSubmitted.some((r) => r.id === `field:${fieldName}`)) continue;
    notSubmitted.push({
      id: `excluded:${fieldName}`,
      title: fieldName,
      explanation: "Excluded by merchant before submission.",
      reason: "merchant_waived",
    });
  }

  // ── Final defense statement ──
  const sections = data.rebuttalDraft?.sections ?? [];
  const bankRebuttalText = sections.length === 0
    ? null
    : sections.map((s) => s.text).join("\n\n");

  // Categories that contributed at least one Strong or Moderate row,
  // surfaced as "Derived from:" metadata. Read from the canonical
  // contributions output — never re-derived from text matching.
  const derivedFromKeys = new Set<string>();
  for (const c of derived.contributions.strong) derivedFromKeys.add(c.label);
  for (const c of derived.contributions.moderate) derivedFromKeys.add(c.label);
  const derivedFrom = Array.from(derivedFromKeys);

  return {
    state,
    submittedAt,
    shopifyAdminUrl,
    cta,
    payload,
    notSubmitted,
    bankRebuttalText,
    derivedFrom,
    rebuttalOutdated: data.rebuttalOutdated === true,
  };
}
