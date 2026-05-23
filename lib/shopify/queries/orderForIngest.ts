/**
 * Single-order GraphQL projection used by the orders/* webhook ingest
 * path. Shape parity with ORDERS_FOR_BACKFILL_QUERY so the same
 * `normalizeBackfillOrder` produces identical row shapes for both
 * backfill (paginated) and webhook ingest (per-order fetch).
 *
 * The wider projection (clientIp, paymentDetails, billingAddress) is
 * added in PR-C — wiring it in both queries simultaneously keeps the
 * normalizer single-shape.
 *
 * Webhook handler always fetches via GraphQL rather than parsing the
 * REST payload. ~15 query points per webhook is negligible relative
 * to the cost of a second normalizer that drifts from the backfill
 * path.
 */

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { assertNotAuthInvalid } from "@/lib/shopify/sessions/getShopBackgroundSession";
import type { RawBackfillOrder } from "./ordersForBackfill";

export const ORDER_FOR_INGEST_QUERY = /* GraphQL */ `
  query ShopOrderForIngest($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      processedAt
      cancelledAt
      cancelReason
      displayFinancialStatus
      displayFulfillmentStatus
      test
      paymentGatewayNames
      clientIp
      totalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      shippingAddress {
        countryCode
      }
      billingAddress {
        countryCode
        zip
      }
      customer {
        id
        email
      }
      shopifyProtect {
        status
      }
      transactions(first: 5) {
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
            wallet
          }
        }
      }
      metafields(first: 8) {
        edges {
          node {
            namespace
            key
            value
          }
        }
      }
      fulfillments(first: 1) {
        createdAt
        displayStatus
      }
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
    }
  }
`;

interface ShopifySession {
  shopDomain: string;
  accessToken: string;
}

interface IngestResponse {
  data?: { order: RawBackfillOrder | null };
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

/**
 * Fetch a single order via GraphQL. Returns null when Shopify reports
 * the order doesn't exist (deleted between webhook fire and our fetch,
 * or shop-id mismatch). Throws on auth/network/API errors so the
 * webhook handler can surface a 500 and let Shopify retry.
 */
export async function fetchOrderForIngest(
  session: ShopifySession,
  orderGid: string,
  opts: { correlationId?: string } = {},
): Promise<RawBackfillOrder | null> {
  // GraphQL fact strings are localized to the shop's Admin language.
  // Pin English (en) so PR-D's parser sees a stable input regardless
  // of the merchant's locale. The locale option is supported by
  // requestShopifyGraphQL (sets Accept-Language).
  const resp: IngestResponse = await requestShopifyGraphQL<{
    order: RawBackfillOrder | null;
  }>({
    session,
    query: ORDER_FOR_INGEST_QUERY,
    variables: { id: orderGid },
    correlationId: opts.correlationId ?? "order-for-ingest",
    locale: "en",
  });

  assertNotAuthInvalid(session.shopDomain, "offline", {
    errors: resp.errors ?? null,
  });

  if (resp.errors && resp.errors.length > 0) {
    throw new Error(
      `Shopify order fetch failed for ${orderGid}: ${resp.errors.map((e) => e.message).join("; ")}`,
    );
  }

  return resp.data?.order ?? null;
}
