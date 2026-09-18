/**
 * Shopify GraphQL queries for disputes.
 *
 * Uses the root-level `disputes` / `dispute` queries (available since 2024-10).
 * These only require `read_shopify_payments_disputes`, unlike the
 * `shopifyPaymentsAccount.disputes` path which also needs
 * `read_shopify_payments` or `read_shopify_payments_accounts`.
 *
 * Pin version is handled by requestShopifyGraphQL → shopifyGraphQLEndpoint.
 */

export const DISPUTE_LIST_QUERY = `
  query DisputeList($first: Int!, $after: String) {
    disputes(first: $first, after: $after) {
      edges {
        node {
          id
          type
          status
          reasonDetails { reason }
          amount { amount currencyCode }
          initiatedAt
          evidenceDueBy
          evidenceSentOn
          finalizedOn
          order { id legacyResourceId name }
          disputeEvidence {
            id
            customerFirstName
            customerLastName
            customerEmailAddress
            shippingAddress { name }
            billingAddress { name }
            # The file the evidence record currently holds. Shopify keeps ONE
            # mutable evidence record per dispute and every save replaces its
            # uncategorizedFile, so the evidence GID is the same on every
            # package and identifies the dispute, not a version. This file GID
            # is what says WHICH package the issuer actually holds — without it
            # a dispute with several saves is unattributable after the fact
            # (lib/postOutcome/buildSnapshot.ts resolvePackageTie).
            uncategorizedFile { id }
          }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

export const DISPUTE_DETAIL_QUERY = `
  query DisputeDetail($id: ID!) {
    dispute(id: $id) {
      id
      type
      status
      reasonDetails { reason }
      amount { amount currencyCode }
      initiatedAt
      evidenceDueBy
      evidenceSentOn
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
      disputeEvidence {
        id
        accessActivityLog
        cancellationPolicyDisclosure
        cancellationRebuttal
        customerFirstName
        customerLastName
        customerEmailAddress
        refundPolicyDisclosure
        refundRefusalExplanation
        uncategorizedText
      }
      # NOTE: ShopifyPaymentsDisputeEvidence.customerCommunication and
      # ShopifyPaymentsDisputeEvidence.shippingDocumentation were removed
      # in Admin API 2026-01 — both are file-only now and read back via
      # customerCommunicationFile / shippingDocumentationFile (see
      # verifyEvidenceReadback.ts). Re-selection is blocked by the
      # schema-drift deny-list in __tests__/schemaDriftGuard.test.ts.
    }
  }
`;

export interface DisputeListNode {
  id: string;
  type: string | null;
  status: string;
  reasonDetails: { reason: string } | null;
  amount: { amount: string; currencyCode: string } | null;
  initiatedAt: string | null;
  evidenceDueBy: string | null;
  evidenceSentOn: string | null;
  finalizedOn: string | null;
  order: {
    id: string;
    legacyResourceId: string;
    name: string;
  } | null;
  disputeEvidence: {
    id: string;
    customerFirstName: string | null;
    customerLastName: string | null;
    customerEmailAddress: string | null;
    shippingAddress?: { name: string | null } | null;
    billingAddress?: { name: string | null } | null;
    /** The file the evidence record holds — identifies WHICH package was
     *  forwarded, where the evidence GID cannot. Optional: absent on every
     *  snapshot captured before 2026-09-01. */
    uncategorizedFile?: { id: string } | null;
  } | null;
}

export interface DisputeListResponse {
  disputes: {
    edges: { node: DisputeListNode; cursor: string }[];
    pageInfo: { hasNextPage: boolean };
  };
}

export interface DisputeDetailNode {
  id: string;
  type: string | null;
  status: string;
  reasonDetails: { reason: string } | null;
  amount: { amount: string; currencyCode: string } | null;
  initiatedAt: string | null;
  evidenceDueBy: string | null;
  evidenceSentOn: string | null;
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
  disputeEvidence: {
    id: string;
    accessActivityLog: string | null;
    cancellationPolicyDisclosure: string | null;
    cancellationRebuttal: string | null;
    customerFirstName: string | null;
    customerLastName: string | null;
    customerEmailAddress: string | null;
    refundPolicyDisclosure: string | null;
    refundRefusalExplanation: string | null;
    uncategorizedText: string | null;
  } | null;
}

export interface DisputeDetailResponse {
  dispute: DisputeDetailNode;
}

/** Fetches dispute with full order/customer/address for profile display.
 *  Note: `phone` is intentionally NOT selected on either address. Shopify
 *  App Store review (2026-05) flagged customer phone as protected data that
 *  may only be accessed when the app demonstrably needs it; DisputeDesk
 *  does not use phone in evidence packs, rebuttal text, or merchant UI. */
export const DISPUTE_PROFILE_QUERY = `
  query DisputeProfile($id: ID!) {
    dispute(id: $id) {
      id
      disputeEvidence {
        customerFirstName
        customerLastName
        customerEmailAddress
        shippingAddress {
          name
          address1
          address2
          city
          province
          provinceCode
          country
          countryCode
          zip
        }
        billingAddress {
          name
          address1
          address2
          city
          province
          provinceCode
          country
          countryCode
          zip
        }
      }
      order {
        id
        legacyResourceId
        name
        createdAt
        totalPriceSet { shopMoney { amount currencyCode } }
        fulfillments(first: 5) {
          id
          status
          trackingInfo(first: 3) { number url company }
          createdAt
        }
        events(first: 30, reverse: true) {
          edges {
            node {
              id
              createdAt
              message
              appTitle
            }
          }
        }
      }
    }
  }
`;

export interface DisputeProfileAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  country: string | null;
  countryCode: string | null;
  zip: string | null;
}

export interface DisputeProfileEvidence {
  customerFirstName: string | null;
  customerLastName: string | null;
  customerEmailAddress: string | null;
  shippingAddress: DisputeProfileAddress | null;
  billingAddress: DisputeProfileAddress | null;
}

export interface DisputeProfileOrder {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  fulfillments: Array<{
    id: string;
    status: string;
    trackingInfo: Array<{ number: string; url: string; company: string }>;
    createdAt: string;
  }>;
  events: {
    edges: Array<{
      node: {
        id: string;
        createdAt: string;
        message: string;
        appTitle: string | null;
      };
    }>;
  } | null;
}

export interface DisputeProfileResponse {
  dispute: {
    id: string;
    disputeEvidence: DisputeProfileEvidence | null;
    order: DisputeProfileOrder | null;
  };
}
