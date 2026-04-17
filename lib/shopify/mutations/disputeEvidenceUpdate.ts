/**
 * disputeEvidenceUpdate mutation — Epic 5.
 *
 * Requires scope: write_shopify_payments_dispute_evidences
 * Requires the disputeEvidence GID (NOT the dispute GID).
 * Requires an ONLINE session (user-context) because it mutates evidence.
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

export interface DisputeEvidenceUpdateInput {
  accessActivityLog?: string;
  cancellationPolicyDisclosure?: string;
  cancellationRebuttal?: string;
  customerEmailAddress?: string;
  customerPurchaseIp?: string;
  refundPolicyDisclosure?: string;
  refundRefusalExplanation?: string;
  shippingDocumentation?: string;
  uncategorizedText?: string;
}

export interface DisputeEvidenceUpdateResult {
  disputeEvidenceUpdate: {
    disputeEvidence: { id: string } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}
