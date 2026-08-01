/**
 * Credit-already-issued detection — one timing comparison, shared.
 *
 * A refund issued BEFORE the cardholder filed is a fundamentally
 * different fact from one issued after. Visa's *Dispute Management
 * Guidelines* list "credit or reversal has already been processed for
 * the transaction" among the grounds that make a dispute **invalid**,
 * and direct the merchant to supply the credit documentation. It is not
 * a compelling-evidence category tied to a reason code — it attaches to
 * the transaction, which is why the defence built on it is
 * reason-code-agnostic.
 *
 * Three orderings exist and only the first is this one (plan §5a F2):
 *
 *   A  refund → chargeback later   allowed, representable   ← THIS
 *   B  chargeback open → refund    Shopify blocks it
 *   C  inquiry → refund            allowed; resolves the inquiry
 *
 * Both `detectFatalLoss` (to stop calling A unwinnable) and the
 * `refund_record` collector (to let the narrative argue it) need the
 * same answer, so it lives here rather than being re-derived.
 *
 * Everything unknown resolves to NOT triggered. A missing dispute date
 * or an unparseable refund timestamp must never be read as "the credit
 * came first" — that would put a claim we cannot support in front of an
 * issuer.
 */

import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

export interface CreditAlreadyIssued {
  /** A refund is on record and precedes the dispute. */
  triggered: boolean;
  /** The latest qualifying (pre-dispute) refund timestamp. */
  refundedAt: string | null;
  /** Total refunded on the order, in the order's currency. */
  amount: number | null;
  /** The credit covers at least `COVERAGE_THRESHOLD` of the disputed
   *  amount. Governs whether copy may say the transaction was credited
   *  IN FULL, and whether the case reaches the strength floor. Never
   *  assert full coverage without it. */
  coversDisputedAmount: boolean;
  /** `disputeAmount - amount` when positive — the portion the credit
   *  does NOT cover, so partial-coverage copy can name it honestly
   *  rather than overclaiming or staying silent. */
  residual: number | null;
  /** True when the refund and the dispute are denominated in DIFFERENT
   *  currencies, so no coverage arithmetic was possible. Distinguishes
   *  "we know it is partial" from "we cannot tell" — both suppress the
   *  in-full claim, but only the former may state a residual. */
  coverageUnknownCurrencyMismatch: boolean;
}

/**
 * How much of the disputed amount a credit must cover to count as full.
 *
 * Not 1.0, because a chargeback routinely arrives slightly ABOVE the
 * order value — the issuer adds fees or rounds. Measured on prod
 * 2026-08-01 across 584 disputes with a matched order:
 *
 *   558 (95.5%)  dispute <= order            a full refund covers it
 *    15 ( 2.6%)  dispute above order, same currency, worst +10.3%
 *    11 ( 1.9%)  dispute above order by >25% — ALL currency mismatches
 *                (CAD dispute / USD order etc.), not real gaps
 *
 * The worst genuine same-currency overage leaves 90.7% coverage, so
 * 0.90 admits every real fee overage and nothing else. blume-box
 * 162042cd sits at 93.6% ($220 credited, $235 disputed) and qualifies.
 *
 * Raising this above ~0.907 would start excluding real full refunds;
 * lowering it much further would start calling genuinely partial
 * credits complete.
 */
export const COVERAGE_THRESHOLD = 0.9;

const NONE: CreditAlreadyIssued = {
  triggered: false,
  refundedAt: null,
  amount: null,
  coversDisputedAmount: false,
  residual: null,
  coverageUnknownCurrencyMismatch: false,
};

export function detectCreditAlreadyIssued(args: {
  order: OrderDetailNode | null;
  disputeAmount: number | null;
  /** `disputes.currency_code`. Coverage arithmetic is only valid when
   *  this matches the refund's currency — 25 prod disputes across 2
   *  shops are denominated differently from their order (CAD dispute /
   *  USD order, EUR / SEK, …), where comparing the raw numbers would
   *  read 200 CAD as covering 178 USD. */
  disputeCurrency?: string | null;
  /** `disputes.initiated_at`. */
  disputeInitiatedAt: string | null;
}): CreditAlreadyIssued {
  const { order, disputeAmount, disputeCurrency, disputeInitiatedAt } = args;
  if (!order) return NONE;

  const disputedAt = parseTime(disputeInitiatedAt);
  if (disputedAt == null) return NONE;

  // Latest refund that still precedes the dispute. "Latest" rather than
  // "first" so the reported date is the most recent credit the
  // cardholder actually received before filing.
  let latestPriorRefund: number | null = null;
  let latestPriorRefundIso: string | null = null;
  for (const refund of order.refunds ?? []) {
    const at = parseTime(refund?.createdAt);
    if (at == null || at >= disputedAt) continue;
    if (latestPriorRefund == null || at > latestPriorRefund) {
      latestPriorRefund = at;
      latestPriorRefundIso = refund.createdAt;
    }
  }
  if (latestPriorRefund == null) return NONE;

  const amount = parseMoney(order.totalRefundedSet?.shopMoney?.amount);
  const refundCurrency = order.totalRefundedSet?.shopMoney?.currencyCode ?? null;

  // Comparing a refund to a dispute across currencies is meaningless,
  // and the failure is asymmetric: a weak-currency refund against a
  // strong-currency dispute reads as MORE than it is, producing a false
  // "credited in full". We do not hold FX rates, so the honest answer is
  // that coverage is unknown — the credit itself is still real, still
  // dated, and still worth arguing.
  const currenciesComparable =
    refundCurrency != null &&
    disputeCurrency != null &&
    refundCurrency.toUpperCase() === disputeCurrency.toUpperCase();
  const currencyMismatch =
    refundCurrency != null && disputeCurrency != null && !currenciesComparable;

  const canCompare =
    currenciesComparable &&
    amount != null &&
    disputeAmount != null &&
    disputeAmount > 0;

  const covers = canCompare
    ? (amount as number) >= (disputeAmount as number) * COVERAGE_THRESHOLD
    : false;
  const residual =
    canCompare && (disputeAmount as number) > (amount as number)
      ? round2((disputeAmount as number) - (amount as number))
      : null;

  return {
    triggered: true,
    refundedAt: latestPriorRefundIso,
    amount,
    coversDisputedAmount: covers,
    residual,
    coverageUnknownCurrencyMismatch: currencyMismatch,
  };
}

function parseTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function parseMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Currency-safe to 2dp — avoids 14.999999999999998 in merchant copy. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
