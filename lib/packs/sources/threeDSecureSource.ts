/**
 * 3-D Secure authentication evidence collector.
 *
 * The Shopify Admin GraphQL typed schema does NOT expose 3DS status
 * (confirmed across all PaymentDetails union members in 2026-01).
 * The data lives only in `OrderTransaction.receiptJson`, which Shopify
 * documents as gateway-defined and not a stable contract.
 *
 * For Shopify Payments orders the receipt is a JSON STRING that mirrors
 * Stripe's PaymentIntent. Verified shape (live probe, 2026-04-26):
 *   receipt = JSON.parse(receiptJson)
 *   receipt.latest_charge.payment_method_details.card.three_d_secure
 *     → null when 3DS was not used
 *     → { authenticated: boolean, result, version, ... } when used
 * Older receipts may flatten `latest_charge` at the root, so we also
 * accept `receipt.payment_method_details.card.three_d_secure` as a
 * fallback path.
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
  const order = ctx.order;
  if (!order) return [];

  const tx = pickPrimaryTransaction(order.transactions);
  if (!tx) return [];

  // Only Shopify Payments. Never assume shape on other gateways.
  if (!SUPPORTED_GATEWAYS.has(tx.gateway)) {
    return [];
  }

  const receipt = parseReceipt(tx.receiptJson);
  if (!receipt) {
    return [];
  }

  const authenticated = readAuthenticatedFlag(receipt);

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
      label: "3-D Secure authentication",
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

/**
 * Receipts come back as JSON strings in 2026-01. Older or proxied
 * gateways may pre-parse them. Accept either; reject everything else.
 */
function parseReceipt(raw: unknown): Record<string, unknown> | null {
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

/**
 * Walk to `three_d_secure.authenticated`. Modern Stripe PaymentIntent
 * receipts nest the charge under `latest_charge`; older charge-level
 * receipts have the path at the root. Try both.
 *
 * Returns null whenever 3DS was not used or the path doesn't resolve —
 * absence of 3DS is never a negative signal in our rubric, so we
 * collapse all "no positive 3DS" states into a single "no signal".
 */
function readAuthenticatedFlag(
  receipt: Record<string, unknown>,
): boolean | null {
  try {
    const candidates: Array<unknown> = [
      // Modern PaymentIntent shape (live-probe verified 2026-04-26)
      (receipt.latest_charge as Record<string, unknown> | undefined)
        ?.payment_method_details,
      // Legacy charge-level shape
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

/** Top-level keys of the receipt — useful for diagnostics when shape drifts. */
function describeShape(receipt: Record<string, unknown>): string | null {
  try {
    return Object.keys(receipt).slice(0, 10).join(",");
  } catch {
    return null;
  }
}
