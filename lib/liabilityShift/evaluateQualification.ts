/**
 * LSE-1 integration point: evaluate CE 3.0 qualification for a dispute
 * and persist the verdict to dispute_qualifications.
 *
 * Called from lib/packs/buildPack.ts right after the network reason
 * code is resolved (LSE-0). The dispute's order + transaction data is
 * already loaded; this helper:
 *   1. Maps the OrderDetailNode → QualificationOrder
 *   2. Fetches the customer's priors from Shopify (filtered to the
 *      120–365 day window server-side)
 *   3. If the disputed order is a subscription, also fetches the
 *      candidate set for the initial-billing branch (same query, no
 *      date filter)
 *   4. Calls qualifyCE30
 *   5. Upserts the verdict to dispute_qualifications
 *
 * Non-fatal: any failure logs + returns without persisting. The pack
 * build continues regardless.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { deriveCardNetwork, pickPrimaryCardTransaction } from "@/lib/disputes/enrichNetworkReasonCode";
import type { OrderDetailNode, OrderTransaction } from "@/lib/shopify/queries/orders";
import { fetchPriorsForCE30 } from "./fetchPriors";
import { pickInitialSubscriptionBilling } from "./priors";
import { qualifyCE30 } from "./qualifyCE30";
import type { CE30Result, QualificationOrder } from "./types";

export interface EvaluateQualificationInput {
  disputeId: string;
  shopId: string;
  shopDomain: string;
  accessToken: string;
  shopifyDisputeId: string;
  /** Network reason code already resolved by LSE-0 (`disputes.network_reason_code`). */
  networkReasonCode: string | null;
  /** Disputed order from the existing buildPack fetch. */
  disputedOrder: OrderDetailNode | null;
  /**
   * Optional: the 3-D Secure state derived from threeDSecureSource.
   * When omitted, the helper reads receiptJson on its own.
   */
  threeDSecure?: {
    authenticated: boolean;
    dataOnly: boolean;
    merchantConfirmed: boolean;
  } | null;
  correlationId?: string;
}

export interface EvaluateQualificationResult {
  persisted: boolean;
  result: CE30Result | null;
  skipReason?: string;
  persistError?: string;
}

export async function evaluateQualification(
  input: EvaluateQualificationInput,
): Promise<EvaluateQualificationResult> {
  // Gate 1: must have a disputed order to qualify against.
  if (!input.disputedOrder) {
    return {
      persisted: false,
      result: null,
      skipReason: "no_disputed_order",
    };
  }
  // Gate 2: must have an LSE-0-resolved network code to even consider
  // CE 3.0. Caller is responsible for running LSE-0 first.
  if (!input.networkReasonCode) {
    return {
      persisted: false,
      result: null,
      skipReason: "no_network_reason_code",
    };
  }

  // 3DS state: prefer the caller-provided value (LSE-2/3 will pass the
  // post-collector struct), otherwise read defensively from receiptJson
  // on the disputed order's primary transaction.
  const threeDSecure =
    input.threeDSecure ?? readThreeDSecureFromOrder(input.disputedOrder);

  const disputedQualOrder = mapOrderDetailToQualificationOrder(
    input.disputedOrder,
    threeDSecure,
  );

  // Gate 3: short-circuit when card network isn't Visa — CE 3.0 only.
  // We still evaluate (qualifyCE30 returns not_applicable) so the
  // dispute_qualifications row is created with a clear reason.
  let priors: QualificationOrder[] = [];
  let initialBilling: QualificationOrder | null = null;

  // Only fetch priors when we'll actually use them — Visa-only + customer present.
  if (
    disputedQualOrder.cardNetwork === "visa" &&
    input.disputedOrder.customer != null &&
    (input.disputedOrder as { customer?: { id?: string | null } }).customer
  ) {
    const customerGid = readCustomerGid(input.disputedOrder);
    if (customerGid) {
      try {
        const fetched = await fetchPriorsForCE30({
          shopDomain: input.shopDomain,
          accessToken: input.accessToken,
          customerGid,
          disputedAt: disputedQualOrder.createdAt,
        });
        priors = fetched.priors;

        // Initial subscription billing — only when disputed order is itself a recurring bill.
        if (disputedQualOrder.subscriptionMarker) {
          // Pull a wider candidate set (skip date filter) for the
          // initial-billing branch. Reuse the same Shopify query but
          // with a generous date floor — Visa permits initial billing
          // < 120 days.
          const wideFetch = await fetchPriorsForCE30({
            shopDomain: input.shopDomain,
            accessToken: input.accessToken,
            customerGid,
            // Look back 3 years for initial billing — covers most subs.
            disputedAt: shiftIso(disputedQualOrder.createdAt, -365 * 2),
            first: 100,
          });
          initialBilling = pickInitialSubscriptionBilling(disputedQualOrder, [
            ...fetched.priors,
            ...wideFetch.priors,
          ]);
        }
      } catch (err) {
        console.warn(
          `[evaluateQualification] prior fetch failed for dispute ${input.disputeId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  const result = qualifyCE30({
    disputed: disputedQualOrder,
    networkReasonCode: input.networkReasonCode,
    priors,
    initialSubscriptionBilling: initialBilling,
  });

  // Persist.
  const sb = getServiceClient();
  const { error } = await sb
    .from("dispute_qualifications")
    .upsert(
      {
        shop_id: input.shopId,
        dispute_id: input.disputeId,
        shopify_dispute_id: input.shopifyDisputeId,
        shopify_order_id: input.disputedOrder.id,
        card_network: disputedQualOrder.cardNetwork ?? "unknown",
        reason_code: input.networkReasonCode,
        program_evaluated: result.program === "ce_30" ? "ce_30" : "none",
        ce30_status: result.verdict,
        ce30_branch: result.branch,
        ce30_match_points: result.matchPoints,
        ce30_has_anchor: result.hasAnchor,
        ce30_qualifying_priors: result.qualifyingPriors,
        ce30_auto_qualification_via: result.autoQualificationVia,
        auto_qualification_fee_applies: result.autoQualificationFeeApplies,
        confidence: result.confidence,
        confidence_reasons: result.confidenceReasons,
        missing_evidence: result.missingEvidence,
        evaluated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,shopify_dispute_id" },
    );

  if (error) {
    return {
      persisted: false,
      result,
      persistError: error.message,
    };
  }

  return { persisted: true, result };
}

/* ── Mapping helpers ── */

function mapOrderDetailToQualificationOrder(
  order: OrderDetailNode,
  threeDSecure: EvaluateQualificationInput["threeDSecure"],
): QualificationOrder {
  const network = deriveCardNetwork(order);
  const primaryTx = pickPrimaryCardTransaction(order.transactions);
  const totalAmount = parseFloat(order.totalPriceSet.shopMoney.amount);
  const totalRefunded = parseFloat(order.totalRefundedSet.shopMoney.amount);
  const isValidationCharge =
    Number.isFinite(totalAmount) && totalAmount > 0 && totalAmount <= 1;

  const subscriptionMarker = detectSubscriptionFromOrderDetail(order);

  // Pull customer GID + email defensively.
  const customer = (order as { customer?: { id?: string; numberOfOrders?: string; createdAt?: string } | null }).customer ?? null;
  const customerGid = customer?.id ?? null;

  return {
    shopifyOrderId: order.id,
    createdAt: order.createdAt,
    customerId: customerGid,
    customerEmail: order.email,
    cardNetwork: network,
    ipAddress: order.clientIp,
    deviceFingerprint: null, // LSE-4 fills this on disputed orders too once available
    shippingAddress: order.shippingAddress
      ? {
          address1: order.shippingAddress.address1,
          address2: order.shippingAddress.address2,
          city: order.shippingAddress.city,
          province: order.shippingAddress.province,
          provinceCode: order.shippingAddress.provinceCode,
          country: order.shippingAddress.country,
          countryCode: order.shippingAddress.countryCode,
          zip: order.shippingAddress.zip,
        }
      : null,
    subscriptionMarker,
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    totalRefunded: Number.isFinite(totalRefunded) ? totalRefunded : 0,
    disputed: true, // The disputed order is, definitionally, disputed.
    isValidationCharge,
    threeDSecure: threeDSecure ?? null,
  };
}

function detectSubscriptionFromOrderDetail(order: OrderDetailNode): string | null {
  // OrderDetailNode's customAttributes shape: { key, value }
  for (const attr of order.customAttributes ?? []) {
    const key = attr.key?.toLowerCase() ?? "";
    if (
      key.endsWith("subscription_id") ||
      key === "subscription_id" ||
      key === "recharge_id"
    ) {
      return `${attr.key}:${attr.value ?? ""}`;
    }
  }
  // The current ORDER_DETAIL_QUERY does not pull sellingPlan on line items;
  // adding it would expand the payload everywhere. For LSE-1 v1 we rely on
  // customAttributes + tags via the wider customer-orders query. The
  // disputed order's subscription marker is rechecked from that query
  // when priors are fetched.
  return null;
}

function readCustomerGid(order: OrderDetailNode): string | null {
  const customer = (order as { customer?: { id?: string | null } | null }).customer;
  return customer?.id ?? null;
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * Defensive 3DS read from the disputed order's primary transaction.
 * Mirrors lib/packs/sources/threeDSecureSource.ts but returns just the
 * boolean state. Only Shopify Payments — other gateways have provider-
 * specific receipt shapes and we don't trust them.
 */
function readThreeDSecureFromOrder(
  order: OrderDetailNode,
): EvaluateQualificationInput["threeDSecure"] {
  const tx = pickPrimaryTransactionFor3DS(order.transactions);
  if (!tx) return null;
  if (tx.gateway !== "shopify_payments") return null;
  const receipt = parseReceiptDefensively(tx.receiptJson);
  if (!receipt) return null;

  // Modern path: receipt.latest_charge.payment_method_details.card.three_d_secure
  const tds =
    getPath(receipt, [
      "latest_charge",
      "payment_method_details",
      "card",
      "three_d_secure",
    ]) ??
    getPath(receipt, ["payment_method_details", "card", "three_d_secure"]);

  if (!tds || typeof tds !== "object") return null;
  const authenticated = (tds as { authenticated?: unknown }).authenticated;
  if (typeof authenticated !== "boolean") return null;

  const version = (tds as { version?: unknown }).version;
  const result = (tds as { result?: unknown }).result;
  // Visa Data Only = data-share without challenge; Stripe surfaces this via
  // `result: "frictionless"` or `electronic_commerce_indicator: "06"` on some
  // shapes. We detect best-effort and fall back to "not data-only".
  const dataOnly =
    (typeof result === "string" && result.toLowerCase() === "frictionless") ||
    (typeof version === "string" && version === "2.0.0");

  return {
    authenticated,
    dataOnly,
    merchantConfirmed: false,
  };
}

function pickPrimaryTransactionFor3DS(
  transactions: OrderTransaction[] | undefined,
): OrderTransaction | null {
  if (!transactions?.length) return null;
  return (
    transactions.find(
      (t) =>
        (t.kind === "SALE" || t.kind === "AUTHORIZATION") &&
        t.status === "SUCCESS",
    ) ??
    transactions[0] ??
    null
  );
}

function parseReceiptDefensively(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function getPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
