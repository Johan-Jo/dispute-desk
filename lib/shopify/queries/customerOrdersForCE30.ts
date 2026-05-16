/**
 * Shopify GraphQL query: customer's prior orders within the CE 3.0
 * 120–365 day window.
 *
 * Used by lib/liabilityShift/fetchPriors.ts to retrieve the candidate
 * set of priors that qualifyCE30 then filters down. Server-side date
 * filtering via the `query` arg keeps the payload bounded — we don't
 * paginate the customer's full history.
 *
 * Field choices are deliberately narrow:
 *  - `clientIp` is the merchant-side IP — directly used by CE 3.0 matching
 *  - `customAttributes` carries subscription markers (Recharge, Bold, Loop)
 *  - `lineItems.sellingPlanAllocation` is the native Shopify Subscriptions marker
 *  - We DON'T fetch transactions / receiptJson here — too expensive across
 *    multiple priors and not needed for the standard CE 3.0 branch. Device
 *    fingerprints come from LSE-4's checkout_sessions table when available.
 */

export const CUSTOMER_ORDERS_FOR_CE30_QUERY = `
  query CustomerOrdersForCE30($customerId: ID!, $query: String!, $first: Int!) {
    customer(id: $customerId) {
      id
      email
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            legacyResourceId
            name
            createdAt
            email
            # Order.cartToken removed in Admin API 2026-01 (see comment
            # in lib/shopify/queries/orders.ts). Prior-order session
            # enrichment in lib/liabilityShift/fetchPriors.ts early-
            # returns when cartToken is null, so the chain degrades to
            # Shopify-only IP without breaking CE 3.0 evaluation.
            clientIp
            displayFinancialStatus
            tags
            customAttributes { key value }
            totalPriceSet { shopMoney { amount currencyCode } }
            totalRefundedSet { shopMoney { amount currencyCode } }
            shippingAddress {
              address1
              address2
              city
              province
              provinceCode
              country
              countryCode
              zip
            }
            lineItems(first: 20) {
              edges {
                node {
                  title
                  sellingPlan { name sellingPlanId }
                }
              }
            }
            # OrderDisputeSummary.initiatedAt was removed in Admin API
            # 2026-01. fetchPriors only checks .disputes.length > 0 to
            # disqualify priors with chargebacks, so the timestamp was
            # dead weight. Re-selection is blocked by the schema-drift
            # deny-list in __tests__/schemaDriftGuard.test.ts.
            disputes {
              id
            }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  }
`;

interface MoneySet {
  shopMoney: { amount: string; currencyCode: string };
}

export interface CE30CandidateOrderAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  country: string | null;
  countryCode: string | null;
  zip: string | null;
}

export interface CE30CandidateOrderNode {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  email: string | null;
  /** Removed from Admin API 2026-01 — always undefined at runtime.
   *  `fetchPriors.ts` reads it via `?? null` and skips enrichment on
   *  the null branch. */
  cartToken?: string | null;
  clientIp: string | null;
  displayFinancialStatus: string | null;
  tags: string[];
  customAttributes: Array<{ key: string; value: string | null }>;
  totalPriceSet: MoneySet;
  totalRefundedSet: MoneySet;
  shippingAddress: CE30CandidateOrderAddress | null;
  lineItems: {
    edges: Array<{
      node: {
        title: string;
        sellingPlan: { name: string; sellingPlanId: string | null } | null;
      };
    }>;
  };
  disputes: Array<{ id: string }>;
}

export interface CustomerOrdersForCE30Response {
  customer: {
    id: string;
    email: string | null;
    orders: {
      edges: Array<{ node: CE30CandidateOrderNode; cursor: string }>;
      pageInfo: { hasNextPage: boolean };
    };
  } | null;
}
