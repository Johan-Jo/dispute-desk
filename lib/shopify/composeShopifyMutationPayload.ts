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
}

/**
 * Pure assembly of the GraphQL mutation payload. No DB access, no
 * Shopify call, no audit events. Same inputs → same output.
 */
export function composeShopifyMutationPayload(
  args: ComposeShopifyMutationPayloadInput,
): DisputeEvidenceUpdateInput {
  const { sections, rebuttalText, disputeReason, customer, manualAttachments, pdfAttachment } = args;

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

  // 3. Manual attachments + pack PDF — appended to uncategorizedText
  //    via the bank-facing block builder.
  const attachmentsBlock = formatManualAttachmentsBlock(
    manualAttachments,
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
