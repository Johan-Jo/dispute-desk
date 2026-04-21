/**
 * disputeEvidenceUpdate mutation.
 *
 * Requires scope: write_shopify_payments_dispute_evidences
 * Works with the shop's durable OFFLINE session (verified 2026-04-21 via
 * scripts/verify-offline-evidence-update.mjs — earlier "requires ONLINE"
 * claim was not supported by the API).
 *
 * VERIFIED SCHEMA (re-introspected 2026-04-21, API 2025-04):
 * - 9 text fields
 * - 6 file fields (ShopifyPaymentsDisputeFileUploadUpdateInput)
 * - 1 address field (MailingAddressInput) — shippingAddress
 * - 1 control field (submitEvidence: Boolean)
 *
 * DOES NOT EXIST (confirmed rejected by API):
 *   customerName, shippingCarrier, shippingDate, shippingTrackingNumber,
 *   productDescription, serviceDate, serviceDocumentation,
 *   shippingDocumentation (text), customerCommunication (text),
 *   customerPurchaseIp (removed from type 2026-04-21 after Shopify returned
 *     "Field is not defined on ShopifyPaymentsDisputeEvidenceUpdateInput";
 *     the IP is now appended to accessActivityLog in saveToShopifyJob).
 */

export const DISPUTE_EVIDENCE_UPDATE_MUTATION = `
  mutation DisputeEvidenceUpdate($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
    disputeEvidenceUpdate(id: $id, input: $input) {
      disputeEvidence {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** File upload input for dispute evidence attachments. */
export interface DisputeFileUploadInput {
  /** GID from REST dispute_file_uploads endpoint (gid://shopify/ShopifyPaymentsDisputeFileUpload/...). */
  id: string;
  /** Set to true to remove the file. */
  destroy?: boolean;
}

/**
 * Verified input type for disputeEvidenceUpdate mutation.
 * Only fields confirmed to exist in the actual GraphQL schema.
 */
export interface DisputeEvidenceUpdateInput {
  // Text fields (9)
  accessActivityLog?: string;
  cancellationPolicyDisclosure?: string;
  cancellationRebuttal?: string;
  customerEmailAddress?: string;
  customerFirstName?: string;
  customerLastName?: string;
  refundPolicyDisclosure?: string;
  refundRefusalExplanation?: string;
  uncategorizedText?: string;

  // File fields
  cancellationPolicyFile?: DisputeFileUploadInput;
  customerCommunicationFile?: DisputeFileUploadInput;
  refundPolicyFile?: DisputeFileUploadInput;
  shippingDocumentationFile?: DisputeFileUploadInput;
  uncategorizedFile?: DisputeFileUploadInput;
  serviceDocumentationFile?: DisputeFileUploadInput;

  // Control
  submitEvidence?: boolean;
}

export interface DisputeEvidenceUpdateResult {
  disputeEvidenceUpdate: {
    disputeEvidence: { id: string } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}
