/**
 * Classifying REFUND transactions. The sibling of `primaryTransaction.ts`: that module picks the payment
 * transaction; this one answers what a refund's transaction says about the money. They are separate questions
 * and both keep their kind/status comparisons in one file (the guard in `__tests__/primaryTransaction.test.ts`
 * allows exactly these two).
 *
 * Statuses, observed live 2026-11-12: PENDING (the refund is on its way; Refund.totalRefundedSet still reads 0.0,
 * about 24 h on the SEK shops), SUCCESS (settled), FAILURE. Anything else (ERROR, AWAITING_RESPONSE, UNKNOWN) is
 * "unrecognised": callers must treat it as unknown, never as "no refund".
 */

export type RefundTransactionStatus = "pending" | "settled" | "failed" | "unrecognised";

interface TxLike {
  kind?: string | null;
  status?: string | null;
}

export function isRefundTransaction(t: TxLike): boolean {
  return (t.kind ?? "").toUpperCase() === "REFUND";
}

export function refundTransactionStatus(t: TxLike): RefundTransactionStatus {
  switch ((t.status ?? "").toUpperCase()) {
    case "PENDING":
      return "pending";
    case "SUCCESS":
      return "settled";
    case "FAILURE":
      return "failed";
    default:
      return "unrecognised";
  }
}
