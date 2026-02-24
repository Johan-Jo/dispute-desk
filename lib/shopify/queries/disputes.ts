/**
 * Shopify GraphQL queries for Shopify Payments disputes.
 * Uses the real ShopifyPaymentsDisputeConnection / ShopifyPaymentsDispute schema.
 *
 * CRITICAL: disputeEvidence { id } is fetched in detail query — this GID is
 * required by disputeEvidenceUpdate in Epic 5.
 */

export const DISPUTES_LIST_QUERY = `
  query DisputesList($first: Int!, $after: String) {
    shopifyPaymentsAccount {
      disputes(first: $first, after: $after) {
        edges {
          cursor
          node {
            id
            status
            reasonDetails {
              reason
            }
            amount {
              amount
              currencyCode
            }
            initiatedAt
            evidenceDueBy
            order {
              id
              name
            }
            disputeEvidence {
              id
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export interface DisputeListNode {
  id: string;
  status: string;
  reasonDetails: { reason: string } | null;
  amount: { amount: string; currencyCode: string };
  initiatedAt: string | null;
  evidenceDueBy: string | null;
  order: { id: string; name: string } | null;
  disputeEvidence: { id: string } | null;
}

export const DISPUTE_DETAIL_QUERY = `
  query DisputeDetail($id: ID!) {
    node(id: $id) {
      ... on ShopifyPaymentsDispute {
        id
        status
        reasonDetails {
          reason
        }
        amount {
          amount
          currencyCode
        }
        initiatedAt
        evidenceDueBy
        order {
          id
          name
          createdAt
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        disputeEvidence {
          id
          accessActivityLog
          cancellationPolicyDisclosure
          cancellationRebuttal
          customerCommunication
          refundPolicyDisclosure
          refundRefusalExplanation
          shippingDocumentation
          uncategorizedText
          customerFirstName
          customerLastName
          fulfillments {
            shippingCarrier
            shippingTrackingNumber
            shippingTrackingUrl
            shippingDate
          }
        }
      }
    }
  }
`;

export interface DisputeDetailNode {
  id: string;
  status: string;
  reasonDetails: { reason: string } | null;
  amount: { amount: string; currencyCode: string };
  initiatedAt: string | null;
  evidenceDueBy: string | null;
  order: {
    id: string;
    name: string;
    createdAt: string;
    totalPriceSet: {
      shopMoney: { amount: string; currencyCode: string };
    };
  } | null;
  disputeEvidence: {
    id: string;
    accessActivityLog: string | null;
    cancellationPolicyDisclosure: string | null;
    cancellationRebuttal: string | null;
    customerCommunication: string | null;
    refundPolicyDisclosure: string | null;
    refundRefusalExplanation: string | null;
    shippingDocumentation: string | null;
    uncategorizedText: string | null;
    customerFirstName: string | null;
    customerLastName: string | null;
    fulfillments: Array<{
      shippingCarrier: string | null;
      shippingTrackingNumber: string | null;
      shippingTrackingUrl: string | null;
      shippingDate: string | null;
    }>;
  } | null;
}
