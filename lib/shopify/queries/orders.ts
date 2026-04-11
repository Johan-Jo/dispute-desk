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
        customer {
          numberOfOrders
          createdAt
          note
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
  events: { edges: Array<{ node: OrderEventNode }> };
  customer: {
    numberOfOrders: string;
    createdAt: string;
    note: string | null;
  } | null;
}

export interface OrderDetailResponse {
  node: OrderDetailNode;
}
