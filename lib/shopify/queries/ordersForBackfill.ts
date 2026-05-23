/**
 * Orders LIST query for the Phase 1 fraud-intelligence backfill.
 *
 * Distinct from `ordersForSnapshot.ts` — the snapshot query carries
 * only id/createdAt/test for chargeback-rate bucketing and is
 * deliberately minimal. The backfill needs the richer projection
 * persisted to `shopify_orders` (timing, risk, fraud-protection,
 * geography). Keeping the two queries separate prevents the cheap
 * snapshot from bloating into a multi-field fetch and burning extra
 * cost on every daily snapshot.
 *
 * Cost budget: ~10–15 query points per order (orders LIST = 2, plus
 * shopifyProtect, fulfillments[0], risk.assessments, addresses).
 * One page of 100 orders ≈ 1500 points — sits comfortably under
 * Shopify's 1000-bucket / 50-restore-rate budget after a single
 * back-off. PAGE_SIZE is intentionally 100 (not 250) for this reason.
 *
 * Schema notes (Admin API 2026-01):
 *   - `Order.risk` returns `OrderRiskSummary` with `assessments[]` +
 *     `recommendation`. Each assessment carries `riskLevel`
 *     (LOW|MEDIUM|HIGH|NONE|PENDING), `provider` (App, may be null
 *     for Shopify's default provider on some shops), and `facts[]`.
 *   - `Order.shopifyProtect` returns `ShopifyProtectOrderSummary` with
 *     `status` ∈ ACTIVE|INACTIVE|NOT_PROTECTED|PENDING|PROTECTED.
 *   - `Order.fulfillments(first: 1)` — we only need the earliest
 *     fulfillment to derive `fulfilled_at`. Querying with
 *     `first: 1, sortKey: …` is not available on this connection in
 *     2026-01 (fulfillments aren't a paginated connection), so we
 *     request the first fulfillment by document order and treat its
 *     `createdAt` as the earliest. The orders LIST already sorts
 *     fulfillments newest-first within an order's payload; if that
 *     proves wrong on real data we'll switch to `first: 20` and pick
 *     the min in code (~10× cost). For v1 we accept the simpler shape.
 *
 * Defensive parsing: every nested object is typed as nullable in
 * TypeScript even where the schema says non-null. A stray null from
 * a stale data fixture or a provider quirk must NOT crash backfill.
 */

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { assertNotAuthInvalid } from "@/lib/shopify/sessions/getShopBackgroundSession";
import {
  readTrackingMetafields,
  type RawShopifyMetafield,
} from "@/lib/shopify/trackingApps";
import { computeRiskPayloadHash } from "@/lib/fraudIntel/riskPayloadHash";

export const ORDERS_FOR_BACKFILL_QUERY = /* GraphQL */ `
  query ShopOrdersForBackfill($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      edges {
        cursor
        node {
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
          # PR-C: structured signal — Order.clientIp is the only place
          # Shopify exposes the customer's IP. The parser cannot recover
          # this from fact strings, so it MUST be projected. Nullable
          # for offline POS / abandoned-checkout-recovered orders.
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
          # PR-C: structured signals for AVS / Card BIN / wallet detection.
          # zip is required to derive AVS-zip-match correlations against
          # the parser-extracted "AVS street match" signals.
          billingAddress {
            countryCode
            zip
          }
          # Customer join keys for v1.5 of order_risk_history view.
          # Both are nullable on the Order type — Shopify allows guest
          # checkouts (no Customer record) and email can be redacted.
          # The normalizer treats either-or-null as fine.
          customer {
            id
            email
          }
          shopifyProtect {
            status
          }
          # Capture the primary transaction's receipt so we can extract
          # 3-D Secure authentication status. first=5 is generous
          # insurance — most orders have 1-3 transactions (sale plus
          # maybe a capture or refund). The receipt is gateway-defined
          # JSON (per lib/packs/sources/threeDSecureSource.ts) — we
          # only trust the shape for Shopify Payments.
          # PR-C: paymentDetails is the structured-signal source for
          # avs_address_result, avs_zip_result, cvv_result, card_bin,
          # card_brand (company), wallet_type. Always preferred over
          # parser-extracted equivalents (see lib/fraudIntel writer).
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
          # Tracking-app metafields. When the merchant has AfterShip /
          # Shipway / ParcelPanel / Wonderment / TrackingMore installed
          # AND has enabled "sync to Shopify", those apps write
          # delivery status + signed-by name + delivered_at into
          # metafields under their own namespace. We read them for
          # free — no merchant action, no third-party API key. The
          # unified reader lives in lib/shopify/trackingApps.ts.
          # first=8 covers the priority namespace per tracking app (PR-C
          # reduced this from 20 to free ~12 cost points/order, which
          # offsets the +5 added by clientIp + paymentDetails).
          metafields(first: 8) {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
          # Fulfillment basics for fulfilled_at + status derivation.
          # NOTE: Fulfillment.metafields is NOT a field in the Admin GraphQL
          # schema (verified 2026-01) — referencing it caused the orders
          # backfill to fail with "Field 'metafields' doesn't exist on type
          # 'Fulfillment'" for every shop. Tracking metafields are read from
          # the order-level metafields connection above; flattenTrackingForRow
          # tolerates the missing per-fulfillment data via ?? fallback.
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// One page = 100 orders. See cost notes above.
export const BACKFILL_PAGE_SIZE = 100;

/** Raw assessment as returned by Shopify (defensive nullable shape). */
export interface RawRiskAssessment {
  riskLevel: string | null;
  provider: { title: string | null } | null;
  facts: Array<{
    description: string | null;
    sentiment: string | null;
  }> | null;
}

/** Raw transaction shape — fields needed for 3DS parsing + PR-C signals. */
export interface RawBackfillTransaction {
  kind: string | null;
  status: string | null;
  gateway: string | null;
  receiptJson: string | Record<string, unknown> | null;
  paymentDetails?: RawPaymentDetails | null;
}

/** Raw paymentDetails union — only CardPaymentDetails carries the
 *  signals we want. Non-card payment methods (Shop Pay, Apple Pay,
 *  gift card, manual) are typed as the base interface; the writer
 *  treats them as null. */
export interface RawPaymentDetails {
  __typename?: string | null;
  avsResultCode?: string | null;
  cvvResultCode?: string | null;
  bin?: string | null;
  company?: string | null;
  wallet?: string | null;
}

/** Raw metafield connection edge as Shopify returns it. */
export interface RawMetafieldEdge {
  node: { namespace: string; key: string; value: string };
}

/** Raw order as returned by Shopify, one page of the backfill query. */
export interface RawBackfillOrder {
  id: string;
  name: string | null;
  createdAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  test: boolean;
  paymentGatewayNames: string[] | null;
  /** PR-C — client IP. Nullable for offline POS, abandoned-checkout
   *  recovered orders, B2B drafts, etc. */
  clientIp?: string | null;
  totalPriceSet: {
    shopMoney: { amount: string; currencyCode: string };
  } | null;
  shippingAddress: { countryCode: string | null } | null;
  /** PR-C — billing address for AVS correlation (zip) + cross-border
   *  detection. */
  billingAddress?: { countryCode: string | null; zip: string | null } | null;
  customer: { id: string | null; email: string | null } | null;
  fulfillments: Array<{
    createdAt: string | null;
    displayStatus: string | null;
  }> | null;
  shopifyProtect: { status: string | null } | null;
  transactions: RawBackfillTransaction[] | null;
  metafields: { edges: RawMetafieldEdge[] } | null;
  risk: {
    recommendation: string | null;
    assessments: RawRiskAssessment[] | null;
  } | null;
}

interface ShopifySession {
  shopDomain: string;
  accessToken: string;
}

interface BackfillPage {
  orders: {
    edges: Array<{ cursor: string; node: RawBackfillOrder }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface BackfillGqlResponse {
  data?: BackfillPage;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export interface BackfillPageResult {
  orders: RawBackfillOrder[];
  endCursor: string | null;
  hasNextPage: boolean;
}

/**
 * Fetch a single page of orders for backfill. Caller manages cursors
 * and progress accounting — keeps the function pure-ish so the job
 * handler can checkpoint between pages and respect the 300s function
 * budget.
 */
export async function fetchOrdersBackfillPage(
  session: ShopifySession,
  args: {
    fromDateIso: string;
    toExclusiveDateIso: string;
    after?: string | null;
    correlationId?: string;
    pageSize?: number;
  },
): Promise<BackfillPageResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.fromDateIso)) {
    throw new Error(
      `fetchOrdersBackfillPage: invalid fromDateIso "${args.fromDateIso}"`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.toExclusiveDateIso)) {
    throw new Error(
      `fetchOrdersBackfillPage: invalid toExclusiveDateIso "${args.toExclusiveDateIso}"`,
    );
  }
  const queryString = `created_at:>=${args.fromDateIso}T00:00:00Z created_at:<${args.toExclusiveDateIso}T00:00:00Z`;
  const pageSize = args.pageSize ?? BACKFILL_PAGE_SIZE;

  const resp: BackfillGqlResponse = await requestShopifyGraphQL<BackfillPage>({
    session,
    query: ORDERS_FOR_BACKFILL_QUERY,
    variables: {
      first: pageSize,
      after: args.after ?? null,
      query: queryString,
    },
    correlationId: args.correlationId ?? `orders-backfill`,
    // PR-C: pin English so risk facts return in a stable language.
    // The parser in PR-D matches on English phrasing — without this
    // pin, a shop's Admin language would drift the fact strings
    // (German "Verdächtig" vs English "Suspicious") and silently
    // break parsing.
    locale: "en",
  });

  assertNotAuthInvalid(session.shopDomain, "offline", {
    errors: resp.errors ?? null,
  });
  if (resp.errors && resp.errors.length > 0) {
    throw new Error(
      `Shopify orders backfill failed: ${resp.errors.map((e) => e.message).join("; ")}`,
    );
  }
  const data = resp.data?.orders;
  if (!data) {
    throw new Error("Shopify orders backfill returned no data");
  }

  return {
    orders: data.edges.map((e) => e.node),
    endCursor: data.pageInfo.endCursor,
    hasNextPage: data.pageInfo.hasNextPage,
  };
}

/** Row shape persisted to the `shopify_orders` table. Pure transform —
 *  no Supabase types — so this module stays free of supabase-js dependency
 *  and the helper is trivially unit-testable. */
export interface ShopifyOrderRow {
  shop_id: string;
  shopify_order_id: string;
  shopify_order_number: string | null;
  processed_at: string | null;
  created_at_shopify: string;
  cancelled_at: string | null;
  fulfilled_at: string | null;
  currency: string;
  order_total: number;
  country: string | null;
  is_cross_border: boolean | null;
  distance_bucket: string | null;
  /** Customer email at the time of latest ingest. Mutable — see
   *  migration 20260520184853_shopify_orders_customer_columns.sql. */
  customer_email: string | null;
  /** Customer Shopify GID (gid://shopify/Customer/123). Mutable;
   *  preferred join key when both are present. */
  customer_shopify_id: string | null;
  payment_gateway: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancel_reason: string | null;
  risk_level_initial: string | null;
  risk_recommendation_initial: string | null;
  risk_provider_initial: string | null;
  fraud_protection_level: string | null;
  /** 3-D Secure authentication outcome for the primary transaction.
   *  Null when unknown / non-Shopify-Payments / receipt unparseable.
   *  True when authenticated; false is rarely observed (the source
   *  collapses non-authenticated states to null). */
  three_ds_authenticated: boolean | null;
  delivery_status: string | null;
  delivered_at_tracking: string | null;
  signed_by_name: string | null;
  tracking_source: string | null;
}

/** Row shape persisted to `shopify_order_risk_assessments`. */
export interface ShopifyOrderRiskAssessmentRow {
  shop_id: string;
  shopify_order_id: string;
  provider: string;
  risk_level: string | null;
  recommendation: string | null;
  facts_json: Array<{ description: string | null; sentiment: string | null }> | null;
  assessed_at: string | null;
  /** Deterministic SHA-256 over the canonical risk payload — see
   *  lib/fraudIntel/riskPayloadHash.ts. Populated for all post-PR-A
   *  rows so the writer can dedup orders/updated webhook fires. Nullable
   *  only for pre-PR-A rows that pre-date the column. */
  risk_payload_hash: string | null;
}

/**
 * Normalize a raw Shopify order into `shopify_orders` + per-assessment
 * rows. Pure — no DB calls, no Shopify calls.
 *
 * Risk snapshot derivation:
 *   - `risk_level_initial` = the highest-severity riskLevel across
 *     assessments. HIGH > MEDIUM > LOW > PENDING > NONE. If no
 *     assessments are present (Shopify has not analyzed the order
 *     yet), we leave all three risk_*_initial fields null so the
 *     immutability trigger lets us populate them on a later pass.
 *   - `risk_recommendation_initial` = the top-level
 *     `risk.recommendation` enum (ACCEPT|INVESTIGATE|REJECT|NONE), or
 *     null when unavailable.
 *   - `risk_provider_initial` = the provider title from the assessment
 *     whose riskLevel matches `risk_level_initial`. Defaults to
 *     "shopify" when the assessment carries no provider (Shopify's
 *     own default analysis returns a null provider on some shops).
 *
 * Cross-border derivation:
 *   - `is_cross_border` = `shipping.countryCode !== storeCountry`.
 *     Null when either side is unknown — we never guess. Caller
 *     supplies `storeCountry`; the shop's home country is fetched
 *     from `shops.country_code` once Commit 3 wires the call site.
 *   - `distance_bucket` is intentionally left null in v1. The field
 *     exists in the schema so future ingest passes can backfill it
 *     without a migration.
 */
const RISK_LEVEL_RANK: Record<string, number> = {
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  PENDING: 1,
  NONE: 0,
};

/**
 * Pure helper: extract the 3-D Secure authenticated flag from a
 * Shopify Payments transaction receipt. Mirrors the contract in
 * lib/packs/sources/threeDSecureSource.ts — only Shopify Payments is
 * trusted; the receipt shape on other gateways is provider-defined
 * and we refuse to read it.
 *
 * Returns:
 *   true  — 3DS authentication completed successfully
 *   null  — unknown, non-Shopify-Payments, receipt unparseable, or
 *           3DS was not used. Absence of 3DS is never a negative
 *           signal in our rubric; all "no positive read" outcomes
 *           collapse to null.
 *
 * Picks the primary transaction (first SUCCESS sale/auth) — same
 * rule as the dispute-evidence collector so backfill and per-dispute
 * read agree.
 */
export function pickThreeDsAuthenticated(
  transactions: RawBackfillTransaction[] | null | undefined,
): boolean | null {
  if (!transactions?.length) return null;
  const tx = transactions.find(
    (t) =>
      (t.kind === "SALE" || t.kind === "AUTHORIZATION") &&
      t.status === "SUCCESS",
  );
  if (!tx) return null;
  if (tx.gateway !== "shopify_payments") return null;
  const receipt = parseReceiptShape(tx.receiptJson);
  if (!receipt) return null;
  return readThreeDsAuthenticatedFromReceipt(receipt);
}

function parseReceiptShape(
  raw: unknown,
): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(raw) ? raw : null;
}

function readThreeDsAuthenticatedFromReceipt(
  receipt: Record<string, unknown>,
): boolean | null {
  try {
    const candidates: unknown[] = [
      // Modern PaymentIntent shape (2026-01)
      (receipt.latest_charge as Record<string, unknown> | undefined)
        ?.payment_method_details,
      // Legacy charge-level fallback
      receipt.payment_method_details,
    ];
    for (const pmd of candidates) {
      if (!isPlainObject(pmd)) continue;
      const card = pmd.card;
      if (!isPlainObject(card)) continue;
      const tds = card.three_d_secure;
      if (!isPlainObject(tds)) continue;
      if (tds.authenticated === true) return true;
    }
    return null;
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pure: flatten a RawBackfillOrder's order-level metafields into the
 *  four tracking-related columns persisted to shopify_orders.
 *
 *  Previously merged per-fulfillment metafields on top of order-level
 *  for per-shipment accuracy, but Fulfillment.metafields is not exposed
 *  by Shopify's Admin GraphQL — referencing it killed the entire
 *  backfill. Order-level metafields are the AfterShip/Shipway/etc.
 *  primary write path anyway when "sync to Shopify" is enabled. */
export function flattenTrackingForRow(raw: RawBackfillOrder): {
  delivery_status: string | null;
  delivered_at_tracking: string | null;
  signed_by_name: string | null;
  tracking_source: string | null;
} {
  const orderMfs: RawShopifyMetafield[] = (raw.metafields?.edges ?? []).map(
    (e) => ({
      namespace: e.node.namespace,
      key: e.node.key,
      value: e.node.value,
    }),
  );
  const merged = readTrackingMetafields(orderMfs);
  return {
    delivery_status: merged.deliveryStatus,
    delivered_at_tracking: merged.deliveredAtTracking,
    signed_by_name: merged.signedByName,
    tracking_source: merged.trackingSource,
  };
}

export function pickInitialRisk(
  assessments: RawRiskAssessment[] | null | undefined,
): { level: string | null; provider: string | null } {
  if (!assessments || assessments.length === 0) {
    return { level: null, provider: null };
  }
  let topLevel: string | null = null;
  let topProvider: string | null = null;
  let topRank = -1;
  for (const a of assessments) {
    const lvl = a.riskLevel ?? null;
    if (!lvl) continue;
    const rank = RISK_LEVEL_RANK[lvl] ?? -1;
    if (rank > topRank) {
      topRank = rank;
      topLevel = lvl;
      topProvider = a.provider?.title?.trim() || null;
    }
  }
  return {
    level: topLevel,
    provider: topLevel ? topProvider ?? "shopify" : null,
  };
}

export function normalizeBackfillOrder(
  shopId: string,
  raw: RawBackfillOrder,
  ctx: { storeCountryCode: string | null },
): { order: ShopifyOrderRow; assessments: ShopifyOrderRiskAssessmentRow[] } {
  const initial = pickInitialRisk(raw.risk?.assessments ?? null);
  const fulfilledAt = pickFulfilledAt(raw.fulfillments ?? null);
  const country = raw.shippingAddress?.countryCode ?? null;
  const isCrossBorder =
    country && ctx.storeCountryCode
      ? country.toUpperCase() !== ctx.storeCountryCode.toUpperCase()
      : null;
  const totalAmount = raw.totalPriceSet?.shopMoney.amount;
  const currency = raw.totalPriceSet?.shopMoney.currencyCode ?? "USD";
  const orderTotal = totalAmount ? Number.parseFloat(totalAmount) : 0;

  const order: ShopifyOrderRow = {
    shop_id: shopId,
    shopify_order_id: raw.id,
    shopify_order_number: raw.name ?? null,
    processed_at: raw.processedAt ?? null,
    created_at_shopify: raw.createdAt,
    cancelled_at: raw.cancelledAt ?? null,
    fulfilled_at: fulfilledAt,
    currency,
    order_total: Number.isFinite(orderTotal) ? orderTotal : 0,
    country,
    is_cross_border: isCrossBorder,
    distance_bucket: null,
    customer_email: raw.customer?.email ?? null,
    customer_shopify_id: raw.customer?.id ?? null,
    payment_gateway: raw.paymentGatewayNames?.[0] ?? null,
    financial_status: raw.displayFinancialStatus ?? null,
    fulfillment_status: raw.displayFulfillmentStatus ?? null,
    cancel_reason: raw.cancelReason ?? null,
    risk_level_initial: initial.level,
    risk_recommendation_initial: raw.risk?.recommendation ?? null,
    risk_provider_initial: initial.provider,
    fraud_protection_level: raw.shopifyProtect?.status ?? null,
    three_ds_authenticated: pickThreeDsAuthenticated(raw.transactions ?? null),
    ...flattenTrackingForRow(raw),
  };

  // Compute the canonical hash once per order. All assessment rows
  // for the same Shopify response carry the same hash, since they
  // represent the same risk payload snapshot. The dedup writer in
  // persistOrders.ts uses the hash to decide whether to append.
  const payloadHash = computeRiskPayloadHash({
    recommendation: raw.risk?.recommendation ?? null,
    assessments: (raw.risk?.assessments ?? []).map((a) => ({
      riskLevel: a.riskLevel ?? null,
      provider: a.provider?.title ?? null,
      facts: a.facts ?? null,
    })),
  });

  const assessments: ShopifyOrderRiskAssessmentRow[] = (
    raw.risk?.assessments ?? []
  )
    .filter((a) => a.riskLevel != null || (a.facts?.length ?? 0) > 0)
    .map((a) => ({
      shop_id: shopId,
      shopify_order_id: raw.id,
      provider: a.provider?.title?.trim() || "shopify",
      risk_level: a.riskLevel ?? null,
      recommendation: raw.risk?.recommendation ?? null,
      facts_json: a.facts ?? null,
      assessed_at: raw.processedAt ?? raw.createdAt,
      risk_payload_hash: payloadHash,
    }));

  return { order, assessments };
}

/** Pick the earliest fulfillment `createdAt` from the (single-page)
 *  fulfillments array. Returns null when no fulfillment is present. */
export function pickFulfilledAt(
  fulfillments: Array<{ createdAt: string | null }> | null | undefined,
): string | null {
  if (!fulfillments || fulfillments.length === 0) return null;
  let earliest: string | null = null;
  for (const f of fulfillments) {
    const ts = f.createdAt ?? null;
    if (!ts) continue;
    if (earliest === null || ts < earliest) earliest = ts;
  }
  return earliest;
}
