/**
 * Pure derivation hook for the ReviewSubmitTab four-section IA.
 *
 * NO fetching, NO state, NO API calls of its own — but the parent
 * passes in a live `SubmissionPreview` (from useSubmissionPreview)
 * which mirrors the GraphQL mutation byte-for-byte. The hook merges:
 *   - workspace.submissionFields (legacy, still authoritative for
 *     the "Not submitted" transparency section)
 *   - submissionPreview.mutationPayload (live, for surfacing customer
 *     details + native file slots that the workspace API doesn't
 *     expose as discrete fields)
 *   - workspace.attachments (merchant-uploaded files)
 *   - pack.pdfPath (the auto-generated pack PDF)
 *   - pack.attachmentUploads (native file routing — which file
 *     landed in which Shopify *File slot)
 *
 * Field content is NEVER transformed — values pass through unchanged,
 * only routed to display groups. The bank sees the same payload pre-
 * and post-grouping.
 */

"use client";

import type { useDisputeWorkspace } from "../hooks/useDisputeWorkspace";
import type {
  SubmissionField,
  WorkspaceAttachment,
} from "../workspace-components/types";
import { getShopifyDisputeUrl } from "@/lib/shopify/shopifyAdminUrl";
import type {
  SubmissionPreview,
  SubmissionMutationPayload,
} from "./useSubmissionPreview";

type Workspace = ReturnType<typeof useDisputeWorkspace>;

/* ── View-model types ── */

export type ReviewState = "submitted" | "ready_to_submit";

export type DataSentGroupKey =
  | "orderDetails"
  | "customerDetails"
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

/** A file the bank will see — either merchant-uploaded, the
 *  auto-generated pack PDF, or a native Shopify file slot. */
export interface DataSentAttachment {
  id: string;
  fileName: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  /** Optional Shopify file slot label (e.g. "Shipping documentation").
   *  When set, the row reads "filename · attached to <slotLabel>". */
  slotLabel: string | null;
  /** When `kind === "pack_pdf"`, the row gets a "Pack PDF" badge so the
   *  merchant knows this is the auto-generated DisputeDesk evidence
   *  pack rather than something they uploaded. */
  kind: "merchant_upload" | "pack_pdf" | "native_slot";
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
  cta: {
    label: string;
    severity: "info" | "warning" | "critical";
    enabled: boolean;
    requiresOverride: boolean;
  } | null;
  /** Six-bucket grouped payload. `null` when no submissionFields are
   *  present (the unsubmitted-empty state). NEVER a loading skeleton. */
  payload: DataSentGroup[] | null;
  /** True while the live submission-preview fetch is in flight. The
   *  section component shows a discreet inline indicator rather than
   *  flickering between empty and populated states. */
  payloadLoading: boolean;
  notSubmitted: NotSubmittedRowViewModel[];
  bankRebuttalText: string | null;
  derivedFrom: string[];
  rebuttalOutdated: boolean;
}

/* ── Group routing ──
 *
 * Maps each Shopify evidence field name to one of the six fixed
 * presentational groups. Field content is unchanged byte-for-byte;
 * this map only decides which header it sits under in the merchant
 * view. A field not in this map falls through to additionalEvidence.
 */

const GROUP_BY_FIELD: Record<string, DataSentGroupKey> = {
  // Order details
  accessActivityLog: "orderDetails",

  // Customer details (name + email — live from the mutation payload)
  customerFirstName: "customerDetails",
  customerLastName: "customerDetails",
  customerEmailAddress: "customerDetails",

  // Customer activity (fulfillment + carrier evidence)
  shippingDocumentation: "customerActivity",
  shippingDocumentationFile: "customerActivity",
  customerCommunicationFile: "customerActivity",
  serviceDocumentationFile: "customerActivity",

  // Policies (4 dedicated Shopify policy/rebuttal fields + policy files)
  refundPolicyDisclosure: "policies",
  cancellationPolicyDisclosure: "policies",
  refundRefusalExplanation: "policies",
  cancellationRebuttal: "policies",
  refundPolicyFile: "policies",
  cancellationPolicyFile: "policies",

  // Additional evidence (catch-all)
  uncategorizedText: "additionalEvidence",
  uncategorizedFile: "additionalEvidence",
};

const GROUP_ORDER: DataSentGroupKey[] = [
  "orderDetails",
  "customerDetails",
  "paymentVerification",
  "customerActivity",
  "policies",
  "additionalEvidence",
];

/** Maps native `*File` slot keys to merchant-facing labels. */
const TARGET_FIELD_LABEL: Record<string, string> = {
  shippingDocumentationFile: "Shipping documentation",
  customerCommunicationFile: "Customer communication",
  serviceDocumentationFile: "Proof of service",
  refundPolicyFile: "Refund policy",
  cancellationPolicyFile: "Cancellation policy",
  uncategorizedFile: "Other evidence",
};

function groupForField(fieldName: string): DataSentGroupKey {
  return GROUP_BY_FIELD[fieldName] ?? "additionalEvidence";
}

function groupForNativeSlot(targetField: string): DataSentGroupKey {
  return GROUP_BY_FIELD[targetField] ?? "additionalEvidence";
}

/* ── Customer details extraction ──
 *
 * The legacy `submissionFields` list (FIELD_MAPPINGS) does not include
 * customer-detail fields. Those values only appear in the raw mutation
 * payload. We surface them as discrete rows so the merchant can see
 * exactly what name/email Shopify will send to the bank.
 */
function customerDetailFields(
  payload: SubmissionMutationPayload | null,
): DataSentField[] {
  if (!payload) return [];
  const out: DataSentField[] = [];
  if (payload.customerFirstName) {
    out.push({
      shopifyFieldName: "customerFirstName",
      label: "Customer first name",
      content: payload.customerFirstName,
      source: "auto",
    });
  }
  if (payload.customerLastName) {
    out.push({
      shopifyFieldName: "customerLastName",
      label: "Customer last name",
      content: payload.customerLastName,
      source: "auto",
    });
  }
  if (payload.customerEmailAddress) {
    out.push({
      shopifyFieldName: "customerEmailAddress",
      label: "Customer email",
      content: payload.customerEmailAddress,
      source: "auto",
    });
  }
  return out;
}

/* ── Hook ── */

export function useReviewView(
  workspace: Workspace,
  submissionPreview?: { preview: SubmissionPreview | null; loading: boolean },
): ReviewViewModel {
  const { data, derived, clientState } = workspace;
  const previewLoading = submissionPreview?.loading ?? false;
  const livePayload = submissionPreview?.preview?.mutationPayload ?? null;

  if (!data) {
    return {
      state: "ready_to_submit",
      submittedAt: null,
      shopifyAdminUrl: null,
      cta: null,
      payload: null,
      payloadLoading: previewLoading,
      notSubmitted: [],
      bankRebuttalText: null,
      derivedFrom: [],
      rebuttalOutdated: false,
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

  // ── Exact data sent to Shopify ──
  // The workspace API hardcodes `data.submissionFields` to []. The
  // authoritative source for "what will be sent" is the live submission
  // preview, which runs the same `composeShopifyMutationPayload` builder
  // as the production save job and maps each non-empty mutation field to
  // a labelled `SubmissionPreviewField` via `FIELD_MAPPINGS`. Use it if
  // we have it; fall back to the (currently empty) workspace list only
  // for forward-compat.
  const previewFields = submissionPreview?.preview?.fields ?? [];
  const fallbackFields = data.submissionFields ?? [];
  const submissionFields: SubmissionField[] =
    previewFields.length > 0
      ? previewFields.map((f) => ({
          shopifyFieldName: f.shopifyFieldName,
          shopifyFieldLabel: f.shopifyFieldLabel,
          content: f.content,
          contentPreview: f.contentPreview,
          source: f.source,
          included: f.included,
        }))
      : fallbackFields;
  const includedFields = submissionFields.filter((f) => f.included);

  const groups: DataSentGroup[] = GROUP_ORDER.map((key) => ({
    key,
    fields: [],
    attachments: [],
  }));
  const groupIndex: Record<DataSentGroupKey, DataSentGroup> = {
    orderDetails: groups[0],
    customerDetails: groups[1],
    paymentVerification: groups[2],
    customerActivity: groups[3],
    policies: groups[4],
    additionalEvidence: groups[5],
  };

  // (a) Structured text fields from the workspace API
  for (const f of includedFields) {
    const bucket = groupIndex[groupForField(f.shopifyFieldName)];
    bucket.fields.push({
      shopifyFieldName: f.shopifyFieldName,
      label: f.shopifyFieldLabel,
      content: f.content,
      source: f.source,
    });
  }

  // (b) Customer details from the live mutation payload (the legacy
  //     submissionFields list omits customer name/email; the bank sees
  //     them so we surface them explicitly).
  for (const f of customerDetailFields(livePayload)) {
    if (
      groupIndex.customerDetails.fields.some(
        (existing) => existing.shopifyFieldName === f.shopifyFieldName,
      )
    ) {
      continue;
    }
    groupIndex.customerDetails.fields.push(f);
  }

  // (c) Native file slots — `pack.attachmentUploads` is the post-save
  //     record of what Shopify has confirmed. Render each as an
  //     attachment in its target group with a "→ <slot>" subtitle.
  const nativeUploads = data.pack?.attachmentUploads ?? [];
  for (const upload of nativeUploads) {
    const bucket = groupIndex[groupForNativeSlot(upload.targetField)];
    const slotLabel =
      TARGET_FIELD_LABEL[upload.targetField] ?? upload.targetField;
    // Try to pull a friendly file name from the merchant-uploaded
    // attachment record (matched by evidenceItemId); fall back to the
    // slot label if no match.
    const matchedAttachment = (data.attachments ?? []).find(
      (a) => a.id === upload.evidenceItemId,
    );
    bucket.attachments.push({
      id: `native:${upload.evidenceItemId}`,
      fileName: matchedAttachment?.fileName ?? slotLabel,
      sizeBytes: matchedAttachment?.sizeBytes ?? null,
      mimeType: matchedAttachment?.mimeType ?? null,
      slotLabel,
      kind: "native_slot",
    });
  }

  // (d) Merchant-uploaded files that did NOT land in a native slot —
  //     these reach the bank as labelled secure links inside
  //     uncategorizedText. Show them under additionalEvidence so the
  //     merchant sees them without double-counting native uploads.
  const nativeUploadIds = new Set(
    nativeUploads.map((u) => u.evidenceItemId),
  );
  const attachments: WorkspaceAttachment[] = data.attachments ?? [];
  for (const att of attachments) {
    if (nativeUploadIds.has(att.id)) continue;
    groupIndex.additionalEvidence.attachments.push({
      id: att.id,
      fileName: att.fileName,
      sizeBytes: att.sizeBytes,
      mimeType: att.mimeType,
      slotLabel: null,
      kind: "merchant_upload",
    });
  }

  // (e) The auto-generated pack PDF — emitted by saveToShopifyJob as a
  //     short-link inside uncategorizedText. Surface it as a discrete
  //     attachment so it isn't buried in the rebuttal text.
  if (data.pack?.pdfPath) {
    groupIndex.additionalEvidence.attachments.push({
      id: "pack-pdf",
      fileName: "Evidence pack (PDF)",
      sizeBytes: null,
      mimeType: "application/pdf",
      slotLabel: null,
      kind: "pack_pdf",
    });
  }

  const populatedGroups = groups.filter(
    (g) => g.fields.length > 0 || g.attachments.length > 0,
  );

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
    payloadLoading: previewLoading,
    notSubmitted,
    bankRebuttalText,
    derivedFrom,
    rebuttalOutdated: data.rebuttalOutdated === true,
  };
}
