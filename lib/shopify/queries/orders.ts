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
        sourceName
        # NOTE: Order.cartToken was removed from Admin API 2026-01.
        # Selecting it fails the entire query with an undefinedField
        # error and silently nulls data.node — confirmed via incident
        # on 2026-05-15 (dispute bd425f70, pack_build_failed). The
        # LSE-4 session-matching path that depended on it falls back
        # to null gracefully; cart_token is still captured on the
        # storefront via the checkout extension and persisted to
        # checkout_sessions directly. A future webhook-side match-back
        # (see lib/liabilityShift/sessions/README.md) will close this
        # gap without the GraphQL read.
        clientIp
        customAttributes { key value }
        totalPriceSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalTaxSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
        # Order-level return status enum (Admin 2026-01): NO_RETURN |
        # RETURN_REQUESTED | IN_PROGRESS | RETURNED | INSPECTION_COMPLETE |
        # RETURN_FAILED. NO_RETURN is the load-bearing value — for a
        # CREDIT_NOT_PROCESSED dispute with no refund issued, it lets the
        # pack cite "the customer never initiated a return" as the grounded
        # basis for "no refund was owed". See lib/packs/sources/orderSource.ts.
        returnStatus
        billingAddress {
          address1
          address2
          city
          province
          provinceCode
          country
          countryCode
          zip
        }
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
          # Native carrier delivery events. Carries the signature name when
          # the carrier reports one (PostNord et al. put "signed by NAME" in
          # the event message — there is no signature enum status). This is
          # the ONLY signature source for merchants without a tracking app
          # that writes a signed_by metafield, and — via the message text —
          # the delivery-status signal (deliveredAt/status enum are
          # unreliable). Consumed by lib/packs/sources/fulfillmentSource.ts.
          # NEWEST first (sortKey HAPPENED_AT + reverse): a return-then-
          # redeliver timeline can exceed the page size, and the LATEST
          # delivery event decides final state. See ordersForBackfill.ts.
          events(first: 30, sortKey: HAPPENED_AT, reverse: true) {
            edges { node { status happenedAt message } }
          }
          # NOTE: Fulfillment.metafields is NOT in the Admin GraphQL
          # 2026-01 schema — confirmed via the same incident as
          # Order.cartToken above (2026-05-15, dispute bd425f70). The
          # tracking-app collector now reads exclusively from the
          # order-level metafields connection below; the consumer in
          # lib/packs/sources/fulfillmentSource.ts treats the per-
          # fulfillment metafields as null via ?? fallback, so the
          # signed-by-name signal still surfaces when tracking apps
          # write at the order level (the common AfterShip default).
          # ordersForBackfill.ts caught this earlier — see comment in
          # that file. The fix did not propagate here at the time.
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
            # BNPL / local methods (Klarna, Affirm, iDEAL, …) surface here,
            # NOT on CardPaymentDetails. Without this fragment the dispute
            # pack builder cannot tell a Klarna/Affirm order from a card
            # one (paymentGatewayNames is "shopify_payments" for both).
            # Parity with ORDERS_FOR_BACKFILL_QUERY. See
            # lib/disputes/paymentContext.ts (derivePaymentContext).
            ... on LocalPaymentMethodsPaymentDetails {
              paymentMethodName
            }
          }
        }
        customer {
          id
          numberOfOrders
          createdAt
          note
        }
        shopifyProtect {
          status
        }
        # Pre-authorization risk assessment — populated on order
        # ingestion via the backfill cron, but post-backfill orders
        # have no row in shopify_order_risk_assessments. Fetching
        # the same shape here on the per-dispute pack build closes
        # the ingestion gap (verified on dispute 30b00826 / order
        # 6437753061433 — created after the 2026-05-11 backfill).
        # buildPack persists this on the row if no row exists yet.
        risk {
          recommendation
          assessments {
            riskLevel
            provider {
              title
            }
            facts {
              description
              sentiment
            }
          }
        }
        # Order-level tracking-app metafields. Fallback when the
        # tracking app writes at the order level instead of per
        # fulfillment (older AfterShip configurations did this).
        metafields(first: 20) {
          edges {
            node {
              namespace
              key
              value
            }
          }
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
  /** Native carrier delivery events. `message` carries a "signed by NAME"
   *  string when the carrier reports a signature (no signature enum
   *  status exists). Optional/nullable — many carriers report no events. */
  events?: {
    edges: Array<{
      node: {
        status: string | null;
        happenedAt: string | null;
        message: string | null;
      };
    }>;
  } | null;
  /** Per-fulfillment tracking-app metafields. Removed from Admin API
   *  2026-01 — no longer queryable; field is always absent at runtime.
   *  Kept as optional on the type so the consumer in
   *  `lib/packs/sources/fulfillmentSource.ts` can read it via the
   *  existing `?? null` fallback without a TS change. */
  metafields?: {
    edges: Array<{
      node: { namespace: string; key: string; value: string };
    }>;
  } | null;
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

/**
 * BNPL / local payment methods (Klarna, Affirm, iDEAL, Bancontact, …).
 * `paymentMethodName` is Shopify's verbatim method name (e.g. "klarna",
 * "klarna_pay_later"). Consumed by lib/disputes/paymentContext.ts to
 * classify the payment-method family without touching the card path.
 */
export interface LocalPaymentMethodsPaymentDetails {
  __typename: "LocalPaymentMethodsPaymentDetails";
  paymentMethodName: string | null;
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
  paymentDetails:
    | CardPaymentDetails
    | LocalPaymentMethodsPaymentDetails
    | { __typename: string }
    | null;
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
  /** Shopify channel id — "web", "android", "iphone", "pos",
   *  "shopify_draft_order", etc. v2.2+: drives the
   *  transaction_channel_online_present predicate. */
  sourceName: string | null;
  /** Removed from Admin API 2026-01. Always undefined at runtime; the
   *  type is kept for downstream callers that null-check defensively
   *  (`cartToken ?? null`). LSE session matching now degrades to
   *  Order.clientIp + checkout_sessions captured by the storefront
   *  extension until the orders/create webhook match-back ships. */
  cartToken?: string | null;
  clientIp: string | null;
  customAttributes: OrderCustomAttribute[];
  totalPriceSet: MoneySet;
  subtotalPriceSet: MoneySet;
  totalShippingPriceSet: MoneySet;
  totalTaxSet: MoneySet;
  totalDiscountsSet: MoneySet;
  totalRefundedSet: MoneySet;
  /** Order-level return status enum (Admin 2026-01). NO_RETURN when the
   *  customer never initiated a return. Nullable defensively. */
  returnStatus: string | null;
  billingAddress: {
    address1: string | null;
    address2: string | null;
    city: string;
    province: string | null;
    provinceCode: string;
    country: string | null;
    countryCode: string;
    zip: string;
  } | null;
  shippingAddress: {
    address1: string | null;
    address2: string | null;
    city: string;
    province: string | null;
    provinceCode: string;
    country: string | null;
    countryCode: string;
    zip: string;
  } | null;
  lineItems: { edges: Array<{ node: OrderLineItem }> };
  fulfillments: OrderFulfillment[];
  refunds: OrderRefund[];
  transactions: OrderTransaction[];
  events: { edges: Array<{ node: OrderEventNode }> };
  customer: {
    id: string;
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
  /** Pre-authorization risk assessment shape. Same as
   *  `ordersForBackfill.ts:RawRiskAssessment` / `risk.assessments[]`.
   *  Fetched here on the per-pack path so post-backfill orders also
   *  get their risk-assessment row persisted into
   *  `shopify_order_risk_assessments`. */
  risk?: {
    recommendation: string | null;
    assessments: Array<{
      riskLevel: string | null;
      provider: { title: string | null } | null;
      facts: Array<{
        description: string | null;
        sentiment: string | null;
      }> | null;
    }> | null;
  } | null;
  /** Order-level tracking-app metafields. Fallback when the tracking
   *  app writes at the order level rather than per fulfillment.
   *  Optional + null-tolerant for golden-fixture compatibility. */
  metafields?: {
    edges: Array<{
      node: { namespace: string; key: string; value: string };
    }>;
  } | null;
}

export interface OrderDetailResponse {
  node: OrderDetailNode;
}
