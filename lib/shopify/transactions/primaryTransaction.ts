/**
 * THE one place that decides which transaction on an order is "the
 * payment". Every reader of per-order payment facts (payment family,
 * card network, 3DS receipt, risk signals, payment_method column) goes
 * through here; a source-scan test fails the build if another function
 * in lib/ or app/ filters transactions by kind/status.
 *
 * Why it exists: five independent pickers drifted apart. One compared
 * lowercase `"sale"`/`"failure"` against Shopify's UPPERCASE enums, so it
 * never matched and fell back to `transactions[0]` — on order #24285
 * that was a FAILED Mastercard attempt that preceded the real, successful
 * Klarna payment, and a Klarna dispute was filed as a Visa/Mastercard one.
 *
 * Rule (case-insensitive on kind/status):
 *   1. first SUCCESS SALE or CAPTURE, in the order Shopify returned them
 *   2. else first SUCCESS AUTHORIZATION
 *   3. else null — a FAILURE / ERROR / PENDING / VOID attempt is NEVER
 *      returned. Callers must treat null as "payment method unknown",
 *      not "card".
 *
 * Split tender: when several transactions succeed we take the first in
 * Shopify's order (stable, deterministic). The dispute carries no link to
 * its own transaction and the order queries do not project amounts, so
 * there is no amount/currency tie-breaker; add one here (not in a caller)
 * if that data is ever fetched.
 */

export interface TransactionLike {
  kind?: string | null;
  status?: string | null;
}

const norm = (v: string | null | undefined): string =>
  (v ?? "").trim().toUpperCase();

/**
 * Every transaction that actually moved money (SUCCESS SALE / CAPTURE /
 * AUTHORIZATION), best first: sale/capture before authorization, each
 * group in Shopify's order. For callers with an extra need on top of
 * "the payment" (e.g. "the first CARD one") — they filter THIS list, never
 * the raw transactions.
 */
export function successfulPayments<T extends TransactionLike>(
  transactions: readonly T[] | null | undefined,
): T[] {
  if (!transactions?.length) return [];
  const succeeded = transactions.filter((t) => norm(t.status) === "SUCCESS");
  const settled = succeeded.filter((t) => {
    const k = norm(t.kind);
    return k === "SALE" || k === "CAPTURE";
  });
  const authorized = succeeded.filter((t) => norm(t.kind) === "AUTHORIZATION");
  return [...settled, ...authorized];
}

export function pickPrimaryTransaction<T extends TransactionLike>(
  transactions: readonly T[] | null | undefined,
): T | null {
  return successfulPayments(transactions)[0] ?? null;
}
