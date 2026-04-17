/**
 * disputeEvidenceUpdate mutation.
 *
 * Requires scope: write_shopify_payments_dispute_evidences
 * Requires an ONLINE session (user-context).
 *
 * VERIFIED SCHEMA (introspected 2026-04-17):
 * - 10 text fields
 * - 6 file fields (ShopifyPaymentsDisputeFileUploadUpdateInput)
 * - 1 address field (MailingAddressInput)
 * - 1 control field (submitEvidence: Boolean)
 *
 * DOES NOT EXIST (confirmed rejected by API):
 * customerName, shippingCarrier, shippingDate, shippingTrackingNumber,
 * productDescription, serviceDate, serviceDocumentation,
 * shippingDocumentation (text), customerCommunication (text)
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
  // Text fields
  accessActivityLog?: string;
  cancellationPolicyDisclosure?: string;
  cancellationRebuttal?: string;
  customerEmailAddress?: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerPurchaseIp?: string;
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
