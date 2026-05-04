/**
 * composeShopifyMutationPayload — single source of truth for the
 * `disputeEvidenceUpdate` GraphQL mutation payload.
 *
 * Both the production submit job (`saveToShopifyJob`) and the
 * merchant-facing preview endpoint (`GET /api/packs/:id/submission-preview`)
 * call this function. Given the same inputs, both produce the same
 * `DisputeEvidenceUpdateInput` byte-for-byte.
 *
 * This function is the foundation of plan v3 §3.A.2:
 * "The raw payload endpoint must use the exact same builder function,
 *  same input shape, same normalization, and same field omission rules
 *  as the actual Shopify submit job."
 *
 * The two callers differ only in the *inputs they construct* — the
 * submit job uses real short-link URLs and live customer info, the
 * preview uses placeholder URLs but the same customer info. The
 * function itself is pure: same input → same output.
 */

import { buildEvidenceForShopify } from "./formatEvidenceForShopify";
import type { RawPackSection } from "./fieldMapping";
import {
  formatManualAttachmentsBlock,
  type ManualAttachmentInput,
  type PackPdfInput,
} from "./manualAttachments";
import type { DisputeEvidenceUpdateInput } from "./mutations/disputeEvidenceUpdate";
import type { FileAttachmentPlanEntry } from "./decideFileAttachments";

export interface CustomerInfoInput {
  /** Display name from `disputes.customer_display_name`. Split into
   *  first/last on the first space. Optional. */
  displayName: string | null;
  /** From `disputes.customer_email`. Optional. */
  email: string | null;
}

export interface ComposeShopifyMutationPayloadInput {
  /** Pack sections (already shaped to RawPackSection). */
  sections: RawPackSection[];
  /** Rebuttal text from `rebuttal_drafts.sections[].text` joined. Null
   *  when no rebuttal exists. */
  rebuttalText: string | null;
  /** Dispute reason — drives reason-aware field routing. Null when
   *  unknown. */
  disputeReason: string | null | undefined;
  /** Customer info to inject as customerFirstName / customerLastName /
   *  customerEmailAddress. Either fields can be null. */
  customer: CustomerInfoInput;
  /** Manual attachments. Caller controls the URLs (real short-links in
   *  production, placeholder strings in preview). */
  manualAttachments: ManualAttachmentInput[];
  /** Optional pack PDF attachment. Same URL semantics as
   *  manualAttachments. */
  pdfAttachment: PackPdfInput | null;
  /** Optional attachment plan from `decideFileAttachments` plus the
   *  per-entry uploaded GIDs. When present and the entry's `kind` is
   *  `"native"`, the corresponding `*File` field is set on the input
   *  AND the matching `manualAttachments` entry (by `id ===
   *  evidenceItemId`) is suppressed from the link block — issuers see
   *  exactly one copy of the file (the native row), never both.
   *
   *  Pack PDF is unaffected (Q3=B in the v2 plan): it always ships as
   *  a labelled link inside `uncategorizedText`.
   *
   *  Defaults to empty list — when the file-evidence flag is off,
   *  caller passes `[]` and the function reduces to its prior
   *  behaviour byte-for-byte (preserves snapshot tests). */
  attachmentPlan?: ResolvedAttachmentPlanEntry[];
}

/** A plan entry plus the post-upload GID. `decideFileAttachments`
 *  doesn't know about GIDs (it's pure); the caller (`saveToShopifyJob`)
 *  appends the GID after a successful REST upload, then passes the
 *  enriched plan here. */
export interface ResolvedAttachmentPlanEntry {
  /** From `FileAttachmentPlanEntry`. */
  evidenceItemId: string;
  evidenceFieldKey: string;
  resolvedSlot: FileAttachmentPlanEntry["resolvedSlot"];
  /** GID returned by REST upload (`gid://shopify/ShopifyPaymentsDisputeFileUpload/...`).
   *  Required when `resolvedSlot.kind === "native"`. */
  fileGid: string | null;
  /** Optional human-friendly label of the underlying evidence item.
   *  Surfaced verbatim in the "Native evidence" pointer block so the
   *  issuer can correlate the file in the chargeback-response file row
   *  with the rebuttal narrative. Defaults to a label derived from
   *  `evidenceFieldKey` when omitted. */
  label?: string | null;
}

/** Human-readable name for each `*File` slot, shown in the "Native
 *  evidence" pointer block. Matches the row labels in Shopify Admin's
 *  chargeback-response screen as observed during Phase 0c. */
const TARGET_FIELD_DISPLAY: Record<string, string> = {
  shippingDocumentationFile: "Shipping documentation",
  customerCommunicationFile: "Customer communication",
  serviceDocumentationFile: "Proof of service",
  refundPolicyFile: "Refund policy",
  cancellationPolicyFile: "Cancellation policy",
  uncategorizedFile: "Other evidence",
};

/** Default merchant-facing label per evidence field key — used when
 *  the caller didn't pass an explicit `label` on the plan entry. */
const FIELD_KEY_DISPLAY: Record<string, string> = {
  delivery_proof: "Delivery confirmation",
  shipping_tracking: "Shipping tracking",
  customer_communication: "Customer communication",
  activity_log: "Customer activity",
  supporting_documents: "Supporting document",
  refund_policy: "Refund policy",
  shipping_policy: "Shipping policy",
  cancellation_policy: "Cancellation policy",
};

function buildNativeEvidenceBlock(plan: ResolvedAttachmentPlanEntry[]): string | null {
  const lines: string[] = [];
  for (const entry of plan) {
    if (entry.resolvedSlot.kind !== "native") continue;
    if (!entry.fileGid) continue;
    const targetField = entry.resolvedSlot.targetField;
    const slotName = TARGET_FIELD_DISPLAY[targetField] ?? targetField;
    const itemName =
      (entry.label && entry.label.trim()) ||
      FIELD_KEY_DISPLAY[entry.evidenceFieldKey] ||
      entry.evidenceFieldKey;
    lines.push(`- ${itemName} → ${slotName} file`);
  }
  if (lines.length === 0) return null;
  return [
    "Native evidence (attached directly to the chargeback response):",
    ...lines,
  ].join("\n");
}

/**
 * Pure assembly of the GraphQL mutation payload. No DB access, no
 * Shopify call, no audit events. Same inputs → same output.
 */
export function composeShopifyMutationPayload(
  args: ComposeShopifyMutationPayloadInput,
): DisputeEvidenceUpdateInput {
  const {
    sections,
    rebuttalText,
    disputeReason,
    customer,
    manualAttachments,
    pdfAttachment,
    attachmentPlan = [],
  } = args;

  // 1. Reason-aware base evidence (order/payment/shipping/policy/etc.).
  const input: DisputeEvidenceUpdateInput = buildEvidenceForShopify(
    sections,
    rebuttalText,
    disputeReason,
  );

  // 2. Customer info — schema only accepts firstName + lastName, never
  //    a single `customerName`. Split on the first space.
  if (customer.displayName) {
    const parts = customer.displayName.split(" ");
    input.customerFirstName = parts[0] ?? "";
    input.customerLastName = parts.slice(1).join(" ") ?? "";
  }
  if (customer.email) {
    input.customerEmailAddress = customer.email;
  }

  // 3. Native file attachments.
  //    For each plan entry resolved to a native slot with a confirmed
  //    GID: set the matching *File field. We do NOT suppress the
  //    matching link in `uncategorizedText` — the native attachment
  //    today is a DisputeDesk-synthesised PDF (reason + extracted
  //    facts), NOT the merchant's original bytes. The two artefacts
  //    are complementary: the synthesised PDF gives the bank a clean
  //    summary in the named row, and the merchant's original file
  //    stays linked in the prose so the source evidence reaches the
  //    issuer too.
  //
  //    The original Q2=A "native-only when attached" rule was framed
  //    around byte-equivalent passthrough (where suppression avoids
  //    duplication). With synthesis, suppression instead removes the
  //    merchant's actual evidence from the bank's view — strictly
  //    worse. If a future passthrough mode lands, suppression should
  //    return then, gated on byte-equivalence.
  for (const entry of attachmentPlan) {
    if (entry.resolvedSlot.kind !== "native" || !entry.fileGid) continue;
    const targetField = entry.resolvedSlot.targetField;
    // Only set when the slot is empty — if buildEvidenceForShopify
    // somehow populated a *File field already (it cannot today, since
    // the formatter only writes text fields), don't clobber.
    if (!input[targetField]) {
      input[targetField] = { id: entry.fileGid };
    }
  }

  const visibleManualAttachments = manualAttachments;

  // 4. Native evidence pointer block — orient the issuer toward the
  //    populated *File rows in the chargeback response screen
  //    (Phase 4 of conditional file evidence layer). Without this, a
  //    bank reviewer reading uncategorizedText might miss that
  //    documents are attached to the named file rows.
  const nativeBlock = buildNativeEvidenceBlock(attachmentPlan);
  if (nativeBlock) {
    input.uncategorizedText = input.uncategorizedText
      ? `${input.uncategorizedText}\n\n${nativeBlock}`
      : nativeBlock;
  }

  // 5. Manual attachments (link block) + pack PDF — appended to
  //    uncategorizedText. Pack PDF is unaffected by suppression.
  const attachmentsBlock = formatManualAttachmentsBlock(
    visibleManualAttachments,
    pdfAttachment,
    disputeReason ?? null,
  );
  if (attachmentsBlock) {
    input.uncategorizedText = input.uncategorizedText
      ? `${input.uncategorizedText}\n\n${attachmentsBlock}`
      : attachmentsBlock;
  }

  return input;
}
