/**
 * Build the Shopify `disputeEvidenceUpdate` input.
 *
 * Post-retirement contract (2026-05-16): the bank-facing submission
 * contains EXACTLY:
 *
 *   - customerFirstName / customerLastName (optional, derived from the
 *     dispute's `customer_display_name` first-token-split when available)
 *   - customerEmailAddress (optional, from the dispute record)
 *   - uncategorizedFile: { id: <defence-package-PDF-file-GID> }
 *   - submitEvidence: true
 *
 * Nothing else. No text fields (`refundPolicyDisclosure`,
 * `cancellationRebuttal`, …) are populated — the defence package PDF
 * IS the bank-facing rebuttal, and Shopify's structured text columns
 * are intentionally left empty so the bank reads a single artifact.
 *
 * The legacy text-routing path (`formatEvidenceForShopify`,
 * `fieldMapping`, `manualAttachments`) was deleted in the same change.
 */

import type { DisputeEvidenceUpdateInput } from "./mutations/disputeEvidenceUpdate";

export interface ComposeShopifyMutationPayloadInput {
  customer: {
    displayName: string | null;
    email: string | null;
  };
  /** Shopify file GID returned by `uploadDisputeFile` after streaming
   *  the defence-package PDF bytes. Required — the submission contract
   *  has no fallback. */
  defencePackagePdfGid: string;
}

export function composeShopifyMutationPayload(
  input: ComposeShopifyMutationPayloadInput,
): DisputeEvidenceUpdateInput {
  const out: DisputeEvidenceUpdateInput = {
    uncategorizedFile: { id: input.defencePackagePdfGid },
    submitEvidence: true,
  };

  const displayName = input.customer.displayName?.trim() ?? "";
  if (displayName) {
    const [first, ...rest] = displayName.split(/\s+/);
    if (first) out.customerFirstName = first;
    const last = rest.join(" ").trim();
    if (last) out.customerLastName = last;
  }

  const email = input.customer.email?.trim();
  if (email) out.customerEmailAddress = email;

  return out;
}
