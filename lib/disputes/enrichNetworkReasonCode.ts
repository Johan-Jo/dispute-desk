/**
 * Persists the resolved network reason code onto a dispute row.
 *
 * Called from the pack-build flow (where order + transaction data is
 * already loaded), so the resolver gets full context (card network,
 * receiptJson, order signals) instead of the Shopify-enum-only signal
 * available at sync time.
 *
 * Resolution failures are non-fatal — a NULL network_reason_code with
 * confidence=unknown is a valid state. Downstream consumers
 * (LSE-1 / LSE-3 / rebuttal engine) fall back to the coarse Shopify
 * enum in that case.
 *
 * See docs/epics/EPIC-LSE-0-reason-codes.md.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { OrderDetailNode, OrderTransaction } from "@/lib/shopify/queries/orders";
import {
  resolveNetworkReasonCode,
  type ResolveResult,
  type OrderContextHint,
} from "./networkReasonCode";
import type { CardNetwork } from "./reasonCodeCatalog";

const CARD_COMPANY_TO_NETWORK: Record<string, CardNetwork> = {
  visa: "visa",
  mastercard: "mastercard",
  "master card": "mastercard",
  "american express": "amex",
  amex: "amex",
  discover: "discover",
};

/**
 * Pick the transaction whose paymentDetails most reliably reflects the
 * actual card used. Prefer `sale` / `capture` over `authorization` so
 * we don't misread a pre-auth-only card vs the captured one.
 */
export function pickPrimaryCardTransaction(
  transactions: OrderTransaction[] | undefined | null,
): OrderTransaction | null {
  if (!transactions || transactions.length === 0) return null;
  const settled =
    transactions.find(
      (t) =>
        (t.kind === "sale" || t.kind === "capture") && t.status !== "failure",
    ) ?? null;
  return settled ?? transactions[0] ?? null;
}

export function deriveCardNetwork(order: OrderDetailNode | null): CardNetwork | null {
  if (!order) return null;
  const tx = pickPrimaryCardTransaction(order.transactions);
  if (!tx?.paymentDetails) return null;
  const pd = tx.paymentDetails as {
    __typename?: string;
    company?: string | null;
  };
  if (pd.__typename !== "CardPaymentDetails") return null;
  const normalized = (pd.company ?? "").trim().toLowerCase();
  return CARD_COMPANY_TO_NETWORK[normalized] ?? null;
}

function deriveOrderContext(order: OrderDetailNode | null): OrderContextHint {
  const hint: OrderContextHint = {};
  if (!order) return hint;

  // Refund signal: any non-zero total refunded.
  const refunded = order.totalRefundedSet?.shopMoney?.amount;
  if (refunded !== undefined) {
    hint.hasRefund = parseFloat(refunded) > 0;
  }

  // Subscription signal: best-effort — Shopify's order shape does not
  // mark "this is a subscription" in a clean field. We treat any line
  // item with a selling-plan hint as a subscription, but the current
  // OrderDetailNode doesn't carry that. Leave undefined for now; later
  // epics can refine when subscription data is added to the query.

  return hint;
}

export interface EnrichInput {
  disputeId: string;
  shopifyReason: string | null;
  order: OrderDetailNode | null;
}

export interface EnrichResult {
  persisted: boolean;
  result: ResolveResult;
  /** True if the persist DB call failed; resolver still returned a value. */
  persistError: string | null;
}

export async function enrichDisputeWithNetworkReasonCode(
  input: EnrichInput,
): Promise<EnrichResult> {
  const network = deriveCardNetwork(input.order);
  const primaryTx = pickPrimaryCardTransaction(input.order?.transactions);
  // Only Shopify Payments' receiptJson is read by the resolver — other
  // gateways have provider-specific shapes we don't trust.
  const receiptJson =
    primaryTx?.gateway === "shopify_payments" ? primaryTx.receiptJson : null;

  const orderContext = deriveOrderContext(input.order);

  const result = resolveNetworkReasonCode({
    shopifyReason: input.shopifyReason,
    cardNetwork: network,
    receiptJson,
    orderContext,
  });

  const sb = getServiceClient();
  const { error } = await sb
    .from("disputes")
    .update({
      network_reason_code: result.code,
      network_reason_code_confidence: result.confidence,
      network_reason_code_resolved_at: new Date().toISOString(),
    })
    .eq("id", input.disputeId);

  if (error) {
    // Non-fatal — the calling code path (buildPack) does not depend
    // on persistence for the current build; the next sync / pack
    // rebuild will retry.
    return {
      persisted: false,
      result,
      persistError: error.message,
    };
  }

  return { persisted: true, result, persistError: null };
}
