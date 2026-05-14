/**
 * Fetches the candidate set of prior orders from Shopify for CE 3.0
 * qualification, and maps each into a `QualificationOrder`.
 *
 * Date filtering happens server-side via Shopify's order-search query
 * syntax — we ask for orders created between 365 days and 120 days
 * before the disputed transaction. The qualifyCE30 engine then applies
 * the rest of the eligibility filters (undisputed, non-refunded, not
 * validation, etc).
 *
 * Device fingerprints are NOT populated here — those come from LSE-4's
 * checkout_sessions table when the merchant has the embed/pixel
 * enabled. For LSE-1 v1 the device field is null on all priors, which
 * means the anchor must be IP.
 */

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  CUSTOMER_ORDERS_FOR_CE30_QUERY,
  type CE30CandidateOrderNode,
  type CustomerOrdersForCE30Response,
} from "@/lib/shopify/queries/customerOrdersForCE30";
import {
  CE30_PRIOR_MAX_DAYS,
  CE30_PRIOR_MIN_DAYS,
  type QualificationOrder,
} from "./types";

export interface FetchPriorsInput {
  shopDomain: string;
  accessToken: string;
  customerGid: string;
  disputedAt: string;
  /** Max priors to retrieve; the filter then keeps the eligible ones. */
  first?: number;
}

export interface FetchPriorsResult {
  priors: QualificationOrder[];
  /** Customer email — used to detect guest-checkout matches downstream. */
  customerEmail: string | null;
}

export async function fetchPriorsForCE30(
  input: FetchPriorsInput,
): Promise<FetchPriorsResult> {
  const { since, until } = computeWindow(input.disputedAt);
  const query = `created_at:>=${since} created_at:<=${until} financial_status:paid`;
  const res = await requestShopifyGraphQL<CustomerOrdersForCE30Response>({
    session: {
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
    },
    query: CUSTOMER_ORDERS_FOR_CE30_QUERY,
    variables: {
      customerId: input.customerGid,
      query,
      first: input.first ?? 50,
    },
  });

  const customer = res.data?.customer ?? null;
  if (!customer) {
    return { priors: [], customerEmail: null };
  }

  const priors: QualificationOrder[] = customer.orders.edges.map((e) =>
    mapCandidateToQualificationOrder(e.node, input.customerGid, customer.email),
  );

  return { priors, customerEmail: customer.email };
}

/**
 * Map a Shopify customer-orders node to a QualificationOrder.
 * Pure — extracted for unit tests.
 */
export function mapCandidateToQualificationOrder(
  node: CE30CandidateOrderNode,
  customerGid: string,
  customerEmail: string | null,
): QualificationOrder {
  const totalAmount = parseFloat(node.totalPriceSet.shopMoney.amount);
  const totalRefunded = parseFloat(node.totalRefundedSet.shopMoney.amount);
  const isValidationCharge =
    Number.isFinite(totalAmount) && totalAmount > 0 && totalAmount <= 1;

  const subscriptionMarker = detectSubscriptionMarker(node);

  // disputes block is non-null when this order has chargebacks/inquiries.
  // The CE 3.0 rule requires undisputed priors.
  const disputed = (node.disputes ?? []).length > 0;

  return {
    shopifyOrderId: node.id,
    createdAt: node.createdAt,
    customerId: customerGid,
    customerEmail: node.email ?? customerEmail,
    cardNetwork: null, // Not fetched on priors (saves payload); standard branch
    //                    matches on IP/shipping/account — card network is only
    //                    used for the gate, which runs against the disputed
    //                    order only.
    ipAddress: node.clientIp,
    deviceFingerprint: null, // Populated by LSE-4 when checkout_sessions data exists.
    shippingAddress: node.shippingAddress,
    subscriptionMarker,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    totalRefunded: Number.isFinite(totalRefunded) ? totalRefunded : 0,
    disputed,
    isValidationCharge,
    threeDSecure: null, // Auto-qualification only evaluates the disputed order.
  };
}

/**
 * Detect a subscription marker on an order. Order of precedence:
 *   1. Native Shopify Subscriptions (lineItems.sellingPlan)
 *   2. Common third-party subscription apps' customAttributes
 *   3. Tag conventions
 */
export function detectSubscriptionMarker(node: CE30CandidateOrderNode): string | null {
  for (const edge of node.lineItems.edges) {
    const sp = edge.node.sellingPlan;
    if (sp?.sellingPlanId) return `selling_plan:${sp.sellingPlanId}`;
    if (sp?.name) return `selling_plan_name:${sp.name}`;
  }

  const subscriptionKeys = new Set([
    "subscription_id",
    "recharge_id",
    "bold_subscription_id",
    "loop_subscription_id",
    "skio_subscription_id",
    "appstle_subscription_id",
  ]);
  for (const attr of node.customAttributes) {
    if (subscriptionKeys.has(attr.key) && attr.value) {
      return `${attr.key}:${attr.value}`;
    }
  }

  const tags = node.tags ?? [];
  const lowered = tags.map((t) => t.toLowerCase());
  if (lowered.some((t) => t === "subscription" || t === "recurring")) {
    return `tag:${tags[lowered.findIndex((t) => t === "subscription" || t === "recurring")]}`;
  }

  return null;
}

function computeWindow(disputedAt: string): { since: string; until: string } {
  const disputed = new Date(disputedAt);
  const since = new Date(disputed);
  since.setUTCDate(disputed.getUTCDate() - CE30_PRIOR_MAX_DAYS);
  const until = new Date(disputed);
  until.setUTCDate(disputed.getUTCDate() - CE30_PRIOR_MIN_DAYS);
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}
