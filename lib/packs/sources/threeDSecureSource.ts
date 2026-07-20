/**
 * 3-D Secure authentication evidence collector.
 *
 * The Shopify Admin GraphQL typed schema does NOT expose 3DS status
 * (confirmed across all PaymentDetails union members in 2026-01).
 * The data lives only in `OrderTransaction.receiptJson`, which Shopify
 * documents as gateway-defined and not a stable contract.
 *
 * For Shopify Payments orders the receipt is a JSON STRING that mirrors
 * Stripe's PaymentIntent. The receipt walk (paths, positive rule, drift
 * history) lives in the shared helper `lib/shopify/receipts/threeDs.ts`
 * — the ONE canonical reader, also used by the orders-ingest picker in
 * `lib/shopify/queries/ordersForBackfill.ts`.
 *
 * Tradeoffs we accept:
 *  1. Shopify Payments only. We refuse to read receipts from any other
 *     gateway because the JSON shape is provider-specific.
 *  2. Best-effort. Wrapped in try/catch — any read failure is silent
 *     and the dispute simply has no 3DS signal.
 *  3. MODERATE classification (not STRONG) because the contract is
 *     unstable and we cannot independently verify the read. The
 *     merchant must confirm in Shopify Admin → order timeline →
 *     "Information from gateway" before the rebuttal cites it as
 *     verified — which then promotes it to STRONG via the manual flow.
 *  4. Bank-rebuttal text never auto-claims 3DS from this read alone
 *     (see `lib/argument/canonicalEvidence.ts` — the strong/moderate
 *     split is the one consumer responsible for that gate).
 */

import type {
  OrderTransaction,
} from "@/lib/shopify/queries/orders";
import { isNonCardPaymentFamily } from "@/lib/disputes/paymentContext";
import {
  parseReceiptJson,
  readThreeDsAuthenticated,
} from "@/lib/shopify/receipts/threeDs";
import type { EvidenceSection, BuildContext } from "../types";

/** Where the 3DS signal came from. */
export type ThreeDSecureSourceTag =
  | "shopify_receipt"   // best-effort read off receiptJson (unstable contract)
  | "merchant_confirmed" // merchant ticked the verification box (STRONG)
  | "none";

export interface ThreeDSecureEvidenceData {
  [key: string]: unknown;
  tdsAuthenticated: boolean | null;
  /** Set by the manual flow when a merchant confirms; never set by this collector. */
  tdsVerified: boolean;
  verifiedSource: ThreeDSecureSourceTag;
  /** Diagnostic — what gateway we read from. */
  gateway: string | null;
  /** Diagnostic — was a receipt JSON present at all. */
  receiptPresent: boolean;
  /** Optional, for debugging. Strip if too noisy. */
  receiptShape?: string | null;
}

/** Gateways whose receiptJson we trust to mirror Stripe's shape. */
const SUPPORTED_GATEWAYS = new Set(["shopify_payments"]);

export async function collectThreeDSecureEvidence(
  ctx: BuildContext,
): Promise<EvidenceSection[]> {
  // Non-card payment (Klarna, Affirm, other BNPL/local): there is no card,
  // so 3-D Secure never applies. Skip intentionally; buildPack records the
  // skip in pack_json.skipped_sections for admin observability.
  if (isNonCardPaymentFamily(ctx.paymentContext.family)) return [];

  const order = ctx.order;
  if (!order) return [];

  const tx = pickPrimaryTransaction(order.transactions);
  if (!tx) return [];

  // Only Shopify Payments. Never assume shape on other gateways.
  if (!SUPPORTED_GATEWAYS.has(tx.gateway)) {
    return [];
  }

  const receipt = parseReceiptJson(tx.receiptJson);
  if (!receipt) {
    return [];
  }

  const authenticated = readThreeDsAuthenticated(receipt);

  // Only emit when we got a definitive boolean. A null read means the
  // shape moved or 3DS wasn't applicable; either way, no signal.
  if (authenticated === null) {
    return [];
  }

  const data: ThreeDSecureEvidenceData = {
    tdsAuthenticated: authenticated,
    // tdsVerified is reserved for the manual-confirmation path. We
    // never set it true from a receipt read.
    tdsVerified: false,
    verifiedSource: "shopify_receipt",
    gateway: tx.gateway,
    receiptPresent: true,
    receiptShape: describeShape(receipt),
  };

  return [
    {
      type: "other",
      labelToken: { key: "packs.section.threeDSecure" },
      source: "shopify_transactions",
      fieldsProvided: ["tds_authentication"],
      data,
    },
  ];
}

/**
 * Pick the transaction whose receipt is most likely to carry 3DS data:
 * the first successful SALE / AUTHORIZATION on the order.
 */
function pickPrimaryTransaction(
  transactions: OrderTransaction[] | undefined,
): OrderTransaction | null {
  if (!transactions?.length) return null;
  return (
    transactions.find(
      (t) =>
        (t.kind === "SALE" || t.kind === "AUTHORIZATION") &&
        t.status === "SUCCESS",
    ) ?? null
  );
}

/** Top-level keys of the receipt — useful for diagnostics when shape drifts. */
function describeShape(receipt: Record<string, unknown>): string | null {
  try {
    return Object.keys(receipt).slice(0, 10).join(",");
  } catch {
    return null;
  }
}
