/**
 * The refund state of an order, as Shopify records it RIGHT NOW. One function, one meaning.
 *
 * Read the order with `lib/shopify/queries/orderRefundState.ts` and pass it here. Nothing in this file does
 * I/O, and nothing else in the app may decide "has this order been refunded" from `Order.totalRefundedSet`
 * or a refund entry's amount: both read 0.0 for the whole pending day (see that file for the evidence).
 *
 * THE FOUR STATES (observed live, 2026-11-12, whj8db-1q / cay-collective / blume-box / 6a8848-dd):
 *   none     No Refund has a REFUND transaction, and the order's refunded total is 0. A `Refund` object with no
 *            transactions is a record with NO money (order edit, cancellation): it does not count.
 *   pending  A REFUND transaction is PENDING. Refund.totalRefundedSet and Order.totalRefundedSet are 0.0.
 *   settled  A REFUND transaction is SUCCESS. The totals now carry the amount.
 *   failed   Every REFUND transaction FAILED.
 *   mixed    One refund settled and another is still pending (cay-collective #24393-shaped).
 *   unknown  We cannot tell. FAIL CLOSED: callers must never read "unknown" as "none".
 *
 * `unknown` is returned for: no order, a read that reached a cap (truncated lists can hide a refund), a REFUND
 * transaction on the order that no Refund owns (a gift-card reversal of a failed checkout looks like a refund
 * and is not one), a status other than PENDING / SUCCESS / FAILURE, an unparseable amount, a refunded total with
 * no transaction behind it, and a settled transaction while the order total still reads 0 (a read taken in the
 * seconds the refund settles: the API was seen internally inconsistent for those seconds).
 *
 * `settledAt` is `Refund.updatedAt`, NOT `processedAt`: processedAt keeps the moment the merchant clicked refund
 * and only `updatedAt` moves when the money lands.
 *
 * `stalledPending`: a refund PENDING for more than 72 h. Normal pending is about 24 h; one PayPal refund has sat
 * pending for eleven weeks. A stalled pending refund is not evidence that money is coming, so callers must not
 * tell a merchant "it is on its way" for it.
 */

import { isRefundTransaction, refundTransactionStatus } from "@/lib/shopify/transactions/refundTransactions";
import {
  REFUND_STATE_ORDER_TX_CAP,
  REFUND_STATE_REFUNDS_CAP,
  REFUND_STATE_REFUND_TX_CAP,
  type RawOrderRefundState,
} from "@/lib/shopify/queries/orderRefundState";

export type RefundStateKind = "none" | "pending" | "settled" | "failed" | "mixed" | "unknown";

export type RefundStateUnknownReason =
  | "no_order"
  | "truncated"
  | "unattributed_refund_transaction"
  | "unrecognised_status"
  | "malformed_amount"
  | "total_without_transaction"
  | "inconsistent_read";

export interface RefundState {
  kind: RefundStateKind;
  /** Why the state is `unknown`; null for every other kind. */
  reason: RefundStateUnknownReason | null;
  pendingAmount: number;
  settledAmount: number;
  failedAmount: number;
  currency: string | null;
  /** Earliest creation time of a refund that carries money (any status). */
  firstRefundAt: string | null;
  /** Latest `Refund.updatedAt` among refunds with a SUCCESS transaction. */
  settledAt: string | null;
  stalledPending: boolean;
  /** One entry per SUCCESS refund transaction: when it settled (`Refund.updatedAt`) and how much. */
  settlements: Array<{ settledAt: string; amount: number }>;
  /** `Order.returnStatus` as read (NO_RETURN | IN_PROGRESS | RETURNED | ...), null when absent. */
  returnStatus: string | null;
  paymentGateways: string[];
  financialStatus: string | null;
}

/** Normal pending is about 24 h (min 24.01 h, max 48.6 h over 242 refunds). Beyond this it is "stalled". */
export const STALLED_PENDING_HOURS = 72;

const EMPTY: Omit<RefundState, "kind" | "reason"> = {
  pendingAmount: 0,
  settledAmount: 0,
  failedAmount: 0,
  currency: null,
  firstRefundAt: null,
  settledAt: null,
  stalledPending: false,
  settlements: [],
  returnStatus: null,
  paymentGateways: [],
  financialStatus: null,
};

function unknown(reason: RefundStateUnknownReason, base: Partial<RefundState> = {}): RefundState {
  return { ...EMPTY, ...base, kind: "unknown", reason };
}

function amountOf(m: { shopMoney?: { amount?: string | number | null } | null } | null | undefined): number {
  const raw = m?.shopMoney?.amount;
  if (raw === null || raw === undefined || raw === "") return Number.NaN;
  return typeof raw === "number" ? raw : Number.parseFloat(raw);
}

function ms(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : Number.NaN;
}

export function resolveRefundState(raw: RawOrderRefundState | null | undefined, now: Date | string): RefundState {
  if (!raw) return unknown("no_order");

  const base: Partial<RefundState> = {
    returnStatus: raw.returnStatus ?? null,
    paymentGateways: Array.isArray(raw.paymentGatewayNames) ? raw.paymentGatewayNames : [],
    financialStatus: raw.displayFinancialStatus ?? null,
  };

  const refunds = raw.refunds ?? [];
  const orderTx = raw.transactions ?? [];

  // A list that reached its cap may be hiding a refund. Never answer "none" from it.
  const truncated =
    refunds.length >= REFUND_STATE_REFUNDS_CAP ||
    orderTx.length >= REFUND_STATE_ORDER_TX_CAP ||
    refunds.some(
      (r) =>
        r.transactions?.pageInfo?.hasNextPage === true ||
        (r.transactions?.nodes?.length ?? 0) >= REFUND_STATE_REFUND_TX_CAP,
    );
  if (truncated) return unknown("truncated", base);

  // Every REFUND transaction on the order must belong to a Refund we read.
  const owned = new Set<string>();
  for (const r of refunds) {
    for (const t of r.transactions?.nodes ?? []) {
      if (isRefundTransaction(t) && t.id) owned.add(t.id);
    }
  }
  for (const t of orderTx) {
    if (isRefundTransaction(t) && (!t.id || !owned.has(t.id))) return unknown("unattributed_refund_transaction", base);
  }

  let pending = 0;
  let settled = 0;
  let failed = 0;
  let currency: string | null = null;
  let firstRefundAt: string | null = null;
  let settledAt: string | null = null;
  let stalled = false;
  const settlements: Array<{ settledAt: string; amount: number }> = [];
  const nowMs = typeof now === "string" ? Date.parse(now) : now.getTime();

  for (const r of refunds) {
    const money = (r.transactions?.nodes ?? []).filter(isRefundTransaction);
    if (money.length === 0) continue; // a Refund with no money: not a refund

    let refundHasPending = false;
    let refundHasSuccess = false;
    let refundSettledAmount = 0;
    for (const t of money) {
      const status = refundTransactionStatus(t);
      const amount = amountOf(t.amountSet);
      if (!Number.isFinite(amount)) return unknown("malformed_amount", base);
      currency = currency ?? t.amountSet?.shopMoney?.currencyCode ?? null;
      if (status === "pending") {
        pending += amount;
        refundHasPending = true;
      } else if (status === "settled") {
        settled += amount;
        refundSettledAmount += amount;
        refundHasSuccess = true;
      } else if (status === "failed") {
        failed += amount;
      } else {
        return unknown("unrecognised_status", base);
      }
    }

    if (r.createdAt && (firstRefundAt === null || ms(r.createdAt) < ms(firstRefundAt))) firstRefundAt = r.createdAt;
    if (refundHasSuccess && r.updatedAt && Number.isFinite(ms(r.updatedAt))) {
      settlements.push({ settledAt: r.updatedAt, amount: refundSettledAmount });
    }
    if (refundHasSuccess && r.updatedAt && (settledAt === null || ms(r.updatedAt) > ms(settledAt))) settledAt = r.updatedAt;
    if (refundHasPending && Number.isFinite(nowMs) && Number.isFinite(ms(r.createdAt))) {
      if (nowMs - ms(r.createdAt) > STALLED_PENDING_HOURS * 3_600_000) stalled = true;
    }
  }

  const total = amountOf(raw.totalRefundedSet);
  if (!Number.isFinite(total)) return unknown("malformed_amount", base);

  const moneyMoved = pending > 0 || settled > 0 || failed > 0;
  if (!moneyMoved && total > 0) return unknown("total_without_transaction", base);
  if (settled > 0 && total <= 0) return unknown("inconsistent_read", base);

  const kind: RefundStateKind =
    pending > 0 && settled > 0 ? "mixed" : pending > 0 ? "pending" : settled > 0 ? "settled" : failed > 0 ? "failed" : "none";

  return {
    ...EMPTY,
    ...base,
    kind,
    reason: null,
    pendingAmount: pending,
    settledAmount: settled,
    failedAmount: failed,
    currency,
    firstRefundAt,
    settledAt,
    stalledPending: stalled,
    settlements,
  };
}

/** The ONLY state in which "no refund has been issued, refund the order" is true. */
export function isNoRefundState(s: RefundState): boolean {
  return s.kind === "none";
}

/** Return states in which the goods are coming back or are back (the trigger for refund advice). */
export function hasOpenOrReceivedReturn(s: RefundState): boolean {
  return s.returnStatus === "IN_PROGRESS" || s.returnStatus === "RETURNED";
}
