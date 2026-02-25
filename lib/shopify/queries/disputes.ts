/**
 * Shopify GraphQL queries for disputes.
 *
 * Uses the shopifyPaymentsAccount.disputes connection.
 * Pin version is handled by requestShopifyGraphQL → shopifyGraphQLEndpoint.
 */

export const DISPUTE_LIST_QUERY = `
  query DisputeList($first: Int!, $after: String) {
    shopifyPaymentsAccount {
      disputes(first: $first, after: $after) {
        edges {
          node {
            id
            status
            reasonDetails { reason }
            amount { amount currencyCode }
            initiatedAt
            evidenceDueBy
            evidenceSentAt
            finalizedOn
            order { id legacyResourceId name }
            evidence { id }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  }
`;

export const DISPUTE_DETAIL_QUERY = `
  query DisputeDetail($id: ID!) {
    node(id: $id) {
      ... on ShopifyPaymentsDispute {
        id
        status
        reasonDetails { reason }
        amount { amount currencyCode }
        initiatedAt
        evidenceDueBy
        evidenceSentAt
        finalizedOn
        order {
          id
          legacyResourceId
          name
          email
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          shippingAddress { city provinceCode countryCode }
          fulfillments(first: 10) {
            id
            status
            trackingInfo(first: 5) { number url company }
            createdAt
          }
        }
        evidence {
          id
          accessActivityLog
          cancellationPolicyDisclosure
          cancellationRebuttal
          customerCommunication
          customerEmailAddress
          refundPolicyDisclosure
          refundRefusalExplanation
          shippingDocumentation
          uncategorizedText
        }
      }
    }
  }
`;

export interface DisputeListNode {
  id: string;
  status: string;
  reasonDetails: { reason: string } | null;
  amount: { amount: string; currencyCode: string } | null;
  initiatedAt: string | null;
  evidenceDueBy: string | null;
  evidenceSentAt: string | null;
  finalizedOn: string | null;
  order: { id: string; legacyResourceId: string; name: string } | null;
  evidence: { id: string } | null;
}

export interface DisputeListResponse {
  shopifyPaymentsAccount: {
    disputes: {
      edges: { node: DisputeListNode; cursor: string }[];
      pageInfo: { hasNextPage: boolean };
    };
  };
}

export interface DisputeDetailNode {
  id: string;
  status: string;
  reasonDetails: { reason: string } | null;
  amount: { amount: string; currencyCode: string } | null;
  initiatedAt: string | null;
  evidenceDueBy: string | null;
  evidenceSentAt: string | null;
  finalizedOn: string | null;
  order: {
    id: string;
    legacyResourceId: string;
    name: string;
    email: string | null;
    createdAt: string;
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    shippingAddress: {
      city: string;
      provinceCode: string;
      countryCode: string;
    } | null;
    fulfillments: Array<{
      id: string;
      status: string;
      trackingInfo: Array<{ number: string; url: string; company: string }>;
      createdAt: string;
    }>;
  } | null;
  evidence: {
    id: string;
    accessActivityLog: string | null;
    cancellationPolicyDisclosure: string | null;
    cancellationRebuttal: string | null;
    customerCommunication: string | null;
    customerEmailAddress: string | null;
    refundPolicyDisclosure: string | null;
    refundRefusalExplanation: string | null;
    shippingDocumentation: string | null;
    uncategorizedText: string | null;
  } | null;
}

export interface DisputeDetailResponse {
  node: DisputeDetailNode;
}
