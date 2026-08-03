/**
 * Network reason-code resolver.
 *
 * CORRECTION (2026-08-03): this header used to claim Shopify does not expose a
 * network reason code, and that the `direct` path below was "currently
 * unreachable". Both are false. `ShopifyPaymentsDisputeReasonDetails.
 * networkReasonCode` exists in 2026-01 — "the raw code provided by the payment
 * network" — and returns real values (verified `4853` on blume-box dispute
 * 11017846977). What is true is that `lib/shopify/queries/disputes.ts` never
 * SELECTS it, so nothing ever reaches the `direct` path and every stored code
 * is inferred from the coarse enum — an inference that can never contradict
 * the enum it came from. Wiring the query is the fix; see docs/technical.md
 * § "What Shopify exposes about a dispute's reason and its issuer documents".
 *
 * The resolver combines:
 *   1. direct   — a caller-supplied `networkReasonCode` (available from
 *                 Shopify today; not yet requested by our queries)
 *   2. derived  — receiptJson parsing for Shopify Payments orders (rare;
 *                 contract is gateway-specific per CLAUDE.md)
 *   3. inferred — Shopify enum + card network + order context → best
 *                 guess (the workhorse path)
 *
 * The resolver never throws on bad input; unresolvable disputes return
 * confidence `unknown` so downstream consumers (LSE-1 / LSE-3 / rebuttal
 * engine) can fall back to the coarse Shopify enum.
 *
 * Tunings: encode the enum→code mappings as data so calibrating against
 * real outcomes (Phase 5+ data) is a config change, not a logic change.
 */

import {
  canonicalReasonCode,
  type AllDisputeReasonCode,
} from "@/lib/rules/disputeReasons";
import {
  REASON_CODE_CATALOG,
  getReasonCode,
  type CardNetwork,
  type ReasonCodeEntry,
} from "./reasonCodeCatalog";

/* ── Public types ── */

export type ResolveConfidence =
  | "direct"
  | "derived"
  | "inferred"
  | "unknown"
  | "not_card_network";

export type ResolveSource =
  | "shopify_dispute_field" // currently unreachable; reserved for future
  | "shopify_receipt_json"
  | "enum_inference"
  | "unresolved";

export interface OrderContextHint {
  /** Order has at least one subscription line item / recurring billing. */
  hasSubscription?: boolean;
  /** Order has been refunded (any amount) before the dispute. */
  hasRefund?: boolean;
  /** Order contains only digital goods (no physical shipment). */
  isDigitalOnly?: boolean;
  /** Two or more transactions at the same amount close in time. */
  hasDuplicateLikeTransactions?: boolean;
}

export interface ResolveInput {
  /** Shopify dispute reason enum value, or null/unknown. */
  shopifyReason: AllDisputeReasonCode | string | null | undefined;
  /** Card network from order transactions, if known. */
  cardNetwork?: CardNetwork | null;
  /**
   * Raw OrderTransaction.receiptJson string or already-parsed object.
   * Only meaningful for Shopify Payments transactions.
   */
  receiptJson?: unknown;
  /** Optional order-shape hints that refine inference. */
  orderContext?: OrderContextHint;
  /**
   * True when the order was paid by a non-card method (Klarna, Affirm,
   * other BNPL/local). Network reason codes are a Visa/Mastercard
   * construct that doesn't exist for these; when set, the resolver
   * short-circuits to an explicit `not_card_network` result instead of
   * the generic `unknown` — so downstream code can tell "we couldn't
   * resolve a card code" apart from "this isn't a card dispute at all".
   */
  isNonCardPayment?: boolean;
}

export interface ResolveResult {
  code: string | null;
  network: CardNetwork | null;
  confidence: ResolveConfidence;
  source: ResolveSource;
  /** Resolved catalog entry, when the code is one we recognize. */
  entry: ReasonCodeEntry | null;
  /** Machine-readable reason for the chosen confidence level. */
  reason: string;
}

/* ── Enum → code inference tables ── */

/**
 * Default (Shopify enum × network) → code mapping. Returns null when the
 * enum does not map to any single dominant code for that network.
 */
const INFERENCE_MAP: Partial<
  Record<AllDisputeReasonCode, Partial<Record<CardNetwork, string>>>
> = {
  FRAUDULENT: {
    visa: "10.4",
    mastercard: "4837",
  },
  UNRECOGNIZED: {
    visa: "10.4",
    mastercard: "4863",
  },
  PRODUCT_NOT_RECEIVED: {
    visa: "13.1",
    mastercard: "4855",
  },
  PRODUCT_UNACCEPTABLE: {
    visa: "13.3",
    mastercard: "4853",
  },
  SUBSCRIPTION_CANCELLED: {
    visa: "13.2",
    mastercard: "4841",
  },
  CREDIT_NOT_PROCESSED: {
    visa: "13.6",
    mastercard: "4860",
  },
  DUPLICATE: {
    visa: "12.6",
    mastercard: "4834",
  },
  BANK_CANNOT_PROCESS: {
    visa: "11.3",
    mastercard: "4808",
  },
  DEBIT_NOT_AUTHORIZED: {
    visa: "11.3",
    mastercard: "4808",
  },
  INCORRECT_ACCOUNT_DETAILS: {
    visa: "12.4",
    mastercard: "4812",
  },
  NONCOMPLIANT: {
    visa: "12.7",
    mastercard: "4849",
  },
  CUSTOMER_INITIATED: {
    mastercard: "4854",
  },
  GENERAL: {
    mastercard: "4854",
  },
  // INSUFFICIENT_FUNDS: issuer-side; no merchant-side network code.
};

/* ── Resolver ── */

export function resolveNetworkReasonCode(input: ResolveInput): ResolveResult {
  // 0. Non-card payment (Klarna, Affirm, other BNPL/local). Network
  //    reason codes are a Visa/Mastercard construct that doesn't apply.
  //    Short-circuit to an explicit result so downstream can distinguish
  //    "not a card dispute" from "card dispute we couldn't resolve".
  if (input.isNonCardPayment) {
    return {
      code: null,
      network: null,
      confidence: "not_card_network",
      source: "unresolved",
      entry: null,
      reason: "non_card_payment_method",
    };
  }

  // 1. Direct path — currently no Shopify-exposed network reason code.
  //    Architecture left in place so this becomes a one-line change when
  //    Shopify adds the field (see EPIC-LSE-0 open question #1).

  // 2. Derived path — Shopify Payments receiptJson.
  const derived = tryDerivedFromReceipt(input);
  if (derived) return derived;

  // 3. Inferred path — Shopify enum + network + order context.
  const inferred = tryInferred(input);
  if (inferred) return inferred;

  // 4. Unknown.
  return {
    code: null,
    network: input.cardNetwork ?? null,
    confidence: "unknown",
    source: "unresolved",
    entry: null,
    reason:
      input.cardNetwork && !input.shopifyReason
        ? "missing_shopify_reason"
        : input.shopifyReason && !input.cardNetwork
          ? "missing_card_network"
          : "no_signal_available",
  };
}

/* ── Derived path ── */

function tryDerivedFromReceipt(input: ResolveInput): ResolveResult | null {
  if (input.receiptJson == null) return null;
  const network = input.cardNetwork ?? null;
  if (!network) return null;

  const receipt = parseReceiptDefensively(input.receiptJson);
  if (!receipt) return null;

  // Defensive read — try several known shapes. The contract is unstable
  // (see CLAUDE.md § 3-D Secure / receiptJson); any read failure returns
  // null and falls through to inference.
  const candidates: Array<unknown> = [];

  // Stripe-shaped: `outcome.network_status` is auth-time; `failure_code`
  // and `dispute.network_reason_code` are dispute-time. We probe both.
  candidates.push(getPath(receipt, ["dispute", "network_reason_code"]));
  candidates.push(getPath(receipt, ["network_reason_code"]));
  candidates.push(getPath(receipt, ["latest_charge", "dispute", "reason"]));
  candidates.push(
    getPath(receipt, ["latest_charge", "failure_code"]),
  );
  candidates.push(getPath(receipt, ["failure_code"]));

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = normalizeNetworkCode(candidate, network);
    if (!normalized) continue;
    const entry = getReasonCode(network, normalized);
    if (!entry) continue;
    return {
      code: entry.code,
      network,
      confidence: "derived",
      source: "shopify_receipt_json",
      entry,
      reason: "matched_from_receipt_json",
    };
  }

  return null;
}

function parseReceiptDefensively(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
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

/**
 * Normalize a raw code string to the catalog's canonical form.
 * Visa codes look like "10.4" or "10_4" or "fraud_other_card_absent";
 * Mastercard codes look like "4837" or "no_authorization".
 *
 * We only accept numeric/dotted forms and ignore the wider mess of
 * gateway-specific string codes (Stripe uses english-y slugs that don't
 * map cleanly to network codes in either direction).
 */
function normalizeNetworkCode(
  raw: string,
  network: CardNetwork,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Replace underscores with dots: "10_4" → "10.4"
  const dotted = trimmed.replace(/_/g, ".");

  // Visa codes match "10.4", "13.1", etc.
  if (network === "visa" && /^\d{2}\.\d{1,2}$/.test(dotted)) {
    return dotted;
  }

  // Mastercard codes match "4837"
  if (network === "mastercard" && /^\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/* ── Inferred path ── */

function tryInferred(input: ResolveInput): ResolveResult | null {
  const network = input.cardNetwork ?? null;
  const shopifyReason = input.shopifyReason ?? null;
  if (!network) return null;
  if (!shopifyReason) return null;

  // Only Visa / Mastercard get LSE-track inference. Amex / Discover
  // fall through to `unknown` for v1; the catalog has no entries for
  // them yet.
  if (network !== "visa" && network !== "mastercard") return null;

  const enumKey = canonicalReasonCode(shopifyReason);
  if (!enumKey) return null;
  const baseCode = INFERENCE_MAP[enumKey]?.[network];
  if (!baseCode) return null;

  // We never silently shift the code based on order context — that would
  // change qualification semantics downstream (e.g. CREDIT_NOT_PROCESSED
  // with hasRefund=true is suspicious but the merchant's defense materially
  // differs by code). Order context only sharpens the diagnostic reason.
  let inferenceReason = `enum_to_code:${enumKey}:${network}`;
  if (
    enumKey === "SUBSCRIPTION_CANCELLED" &&
    input.orderContext?.hasSubscription === false
  ) {
    inferenceReason = `${inferenceReason}:no_subscription_signal`;
  }
  if (
    enumKey === "DUPLICATE" &&
    input.orderContext?.hasDuplicateLikeTransactions === false
  ) {
    inferenceReason = `${inferenceReason}:no_duplicate_signal`;
  }

  const entry = getReasonCode(network, baseCode);
  if (!entry) return null;

  return {
    code: entry.code,
    network,
    confidence: "inferred",
    source: "enum_inference",
    entry,
    reason: inferenceReason,
  };
}

/* ── Convenience exports ── */

/** All catalog codes a resolver could theoretically return. */
export function knownCodes(): { network: CardNetwork; code: string }[] {
  return REASON_CODE_CATALOG.map((e) => ({
    network: e.network,
    code: e.code,
  }));
}

/**
 * The Shopify enum values our rebuttal + collector pipeline treats as
 * "fraud-family" — i.e. the cardholder is claiming they did not
 * authorize the transaction. These are the only reason codes for
 * which positive pre-authorization risk-screening signals
 * (Shopify's `Order.risk` LOW recommendation, AVS/CVV match,
 * 3-D Secure authentication) are evidentially relevant.
 *
 * NOT included on purpose:
 *   - CREDIT_NOT_PROCESSED: refund-flow dispute; risk screening is irrelevant.
 *   - PRODUCT_NOT_RECEIVED / PRODUCT_UNACCEPTABLE / SUBSCRIPTION_CANCELLED:
 *     delivery / quality / contract-lifecycle disputes; the cardholder
 *     authorized the original transaction, so a "low risk at checkout"
 *     citation does not address the merchant's burden of proof.
 *   - DUPLICATE / NONCOMPLIANT / BANK_CANNOT_PROCESS / etc.: structural
 *     network disputes; the cardholder identity question is moot.
 *
 * Reading the canonical reason set this way keeps the fraud-rebuttal
 * collector and the rebuttal-text composer aligned without either
 * one hard-coding `reason === "FRAUDULENT"` and silently dropping
 * UNRECOGNIZED variants.
 */
export const FRAUD_FAMILY_REASON_CODES: ReadonlySet<string> = new Set([
  "FRAUDULENT",
  "UNRECOGNIZED",
]);

export function isFraudFamilyReason(
  reason: string | null | undefined,
): boolean {
  if (!reason) return false;
  return FRAUD_FAMILY_REASON_CODES.has(reason.toUpperCase());
}
