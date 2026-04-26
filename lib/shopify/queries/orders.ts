/**
 * Shopify GraphQL queries for order details.
 *
 * Used by the evidence pack builder to pull order, fulfillment,
 * and shipping data for a dispute's associated order.
 */

export const ORDER_DETAIL_QUERY = `
  query OrderDetail($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        name
        legacyResourceId
        email
        createdAt
        cancelledAt
        closedAt
        displayFinancialStatus
        displayFulfillmentStatus
        note
        clientIp
        customAttributes { key value }
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
        billingAddress {
          city
          provinceCode
          countryCode
          zip
        }
        shippingAddress {
          city
          provinceCode
          countryCode
          zip
        }
        lineItems(first: 50) {
          edges {
            node {
              title
              variantTitle
              quantity
              originalTotalSet { shopMoney { amount currencyCode } }
              sku
            }
          }
        }
        fulfillments(first: 20) {
          id
          status
          displayStatus
          createdAt
          updatedAt
          deliveredAt
          estimatedDeliveryAt
          trackingInfo(first: 10) {
            number
            url
            company
          }
          fulfillmentLineItems(first: 50) {
            edges {
              node {
                lineItem { title }
                quantity
              }
            }
          }
        }
        refunds(first: 10) {
          id
          createdAt
          note
          totalRefundedSet { shopMoney { amount currencyCode } }
        }
        events(first: 30) {
          edges {
            node {
              id
              message
              createdAt
              attributeToUser
              attributeToApp
              criticalAlert
            }
          }
        }
        transactions(first: 10) {
          id
          kind
          status
          gateway
          receiptJson
          paymentDetails {
            __typename
            ... on CardPaymentDetails {
              avsResultCode
              cvvResultCode
              bin
              company
              number
              name
              expirationMonth
              expirationYear
              wallet
            }
          }
        }
        customer {
          numberOfOrders
          createdAt
          note
        }
        shopifyProtect {
          status
        }
      }
    }
  }
`;

interface MoneySet {
  shopMoney: { amount: string; currencyCode: string };
}

export interface OrderLineItem {
  title: string;
  variantTitle: string | null;
  quantity: number;
  originalTotalSet: MoneySet;
  sku: string | null;
}

export interface OrderFulfillment {
  id: string;
  status: string;
  displayStatus: string | null;
  createdAt: string;
  updatedAt: string | null;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
  trackingInfo: Array<{
    number: string | null;
    url: string | null;
    company: string | null;
  }>;
  fulfillmentLineItems: {
    edges: Array<{
      node: {
        lineItem: { title: string };
        quantity: number;
      };
    }>;
  };
}

export interface OrderRefund {
  id: string;
  createdAt: string;
  note: string | null;
  totalRefundedSet: MoneySet;
}

export interface OrderCustomAttribute {
  key: string;
  value: string | null;
}

export interface OrderEventNode {
  id: string;
  message: string;
  createdAt: string;
  attributeToUser: boolean;
  attributeToApp: boolean;
  criticalAlert: boolean;
}

export interface CardPaymentDetails {
  __typename: "CardPaymentDetails";
  avsResultCode: string | null;
  cvvResultCode: string | null;
  bin: string | null;
  company: string | null;
  number: string | null;
  name: string | null;
  expirationMonth: number | null;
  expirationYear: number | null;
  wallet: string | null;
}

export interface OrderTransaction {
  id: string;
  kind: string;
  status: string;
  gateway: string;
  /**
   * Gateway-specific receipt blob. The Admin API returns it as a JSON
   * scalar — in practice a JSON STRING for Shopify Payments orders;
   * older proxies may pre-parse to an object. Either way the shape is
   * NOT a stable contract per Shopify docs. Only read defensively
   * (parse + narrow paths). For Shopify Payments orders this mirrors
   * Stripe's PaymentIntent and includes
   * `latest_charge.payment_method_details.card.three_d_secure.authenticated`.
   */
  receiptJson: string | Record<string, unknown> | null;
  paymentDetails: CardPaymentDetails | { __typename: string } | null;
}

export interface OrderDetailNode {
  id: string;
  name: string;
  legacyResourceId: string;
  email: string | null;
  createdAt: string;
  cancelledAt: string | null;
  closedAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  note: string | null;
  clientIp: string | null;
  customAttributes: OrderCustomAttribute[];
  totalPriceSet: MoneySet;
  subtotalPriceSet: MoneySet;
  totalShippingPriceSet: MoneySet;
  totalTaxSet: MoneySet;
  totalDiscountsSet: MoneySet;
  totalRefundedSet: MoneySet;
  billingAddress: {
    city: string;
    provinceCode: string;
    countryCode: string;
    zip: string;
  } | null;
  shippingAddress: {
    city: string;
    provinceCode: string;
    countryCode: string;
    zip: string;
  } | null;
  lineItems: { edges: Array<{ node: OrderLineItem }> };
  fulfillments: OrderFulfillment[];
  refunds: OrderRefund[];
  transactions: OrderTransaction[];
  events: { edges: Array<{ node: OrderEventNode }> };
  customer: {
    numberOfOrders: string;
    createdAt: string;
    note: string | null;
  } | null;
  /** Shopify Protect summary. Null when the program is not applicable
   *  (non-Shopify-Payments order, ineligible region, or older order). */
  shopifyProtect: {
    /** PROTECTED = chargeback already covered. ACTIVE = eligible & live.
     *  PENDING = decision pending. INACTIVE = ineligible.
     *  NOT_PROTECTED = chargeback received but not covered. */
    status: "ACTIVE" | "INACTIVE" | "NOT_PROTECTED" | "PENDING" | "PROTECTED";
  } | null;
}

export interface OrderDetailResponse {
  node: OrderDetailNode;
}
