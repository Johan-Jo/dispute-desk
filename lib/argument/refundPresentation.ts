/**
 * Refund-row presentation helper.
 *
 * The refund signal's generic label ("Refund status") names a CATEGORY,
 * not a fact — the merchant reading the evidence list cannot tell whether
 * the order was refunded or not (live complaint, cay dispute cc86296d,
 * 2026-07-16). This helper maps the collected payload to a fact-stating
 * title + facts line:
 *
 *   refund_record  ({refundStatus: "processed", amount, currency,
 *                    refundedAt})            → "Refund issued" +
 *                                              "{amount} {currency} refunded on {date}"
 *   no_return_initiated ({returnStatus: "NO_RETURN"})
 *                                            → "No return initiated" +
 *                                              "the customer never initiated a return"
 *                                              (+ the refund statement's sentence,
 *                                              only when it is kind `none`)
 *
 * A zero-amount refund ENTRY is not "no refund issued": the entry may be a
 * failed, pending or later-settled refund, so no `refundStatus: "none"` branch
 * exists here. What Shopify records about refunds is stated by
 * lib/disputes/refundStatement.ts, the one reader of those fields.
 *
 * Lib code emits i18n tokens, never English. Returns null when the
 * payload matches neither shape (the caller keeps the generic label).
 */

import type { I18nToken } from "@/lib/i18n/token";
import { shortEvidenceDate } from "@/lib/argument/deliveryPresentation";
import { refundStatementTokens, type RefundStatement } from "@/lib/disputes/refundStatement";

const NS = "disputes.refundStatus";

export interface RefundPresentation {
  /** Fact-stating title: "Refund issued" / "No return initiated". */
  titleToken: I18nToken;
  /** Compact facts line(s) answering how much / when / why. */
  factsTokens: I18nToken[];
}

export function buildRefundPresentation(
  payload: Record<string, unknown> | null | undefined,
  refundStatement?: RefundStatement | null,
  /** The dispute account's refund sentence, when the caller has one: the row
   *  then says exactly what the account says (lib/disputes/disputeAccount.ts). */
  accountRefundSentence?: I18nToken | null,
): RefundPresentation | null {
  const p = payload ?? {};

  // Refund actually issued (refund_record payload).
  if (p.refundStatus === "processed") {
    // When the refund statement says `some`, ITS amount and date win: the
    // collector's `refundedAt` is the latest entry (which can be a failed 0.0
    // one), the statement takes the date from positive entries only.
    const fromStatement = refundStatement?.kind === "some" ? refundStatement : null;
    const amountRaw = fromStatement?.amount
      ? fromStatement.amount
      : typeof p.amount === "string"
        ? p.amount.trim()
        : typeof p.amount === "number"
          ? String(p.amount)
          : null;
    const currency = fromStatement?.currency
      ? fromStatement.currency
      : typeof p.currency === "string"
        ? p.currency.trim()
        : null;
    const date = shortEvidenceDate(fromStatement ? fromStatement.refundedAt ?? null : p.refundedAt);
    const factsTokens: I18nToken[] = [];
    if (amountRaw && currency && date) {
      factsTokens.push({
        key: `${NS}.factsIssued`,
        params: { amount: amountRaw, currency, date },
      });
    } else if (amountRaw && currency) {
      factsTokens.push({
        key: `${NS}.factsIssuedNoDate`,
        params: { amount: amountRaw, currency },
      });
    } else if (date) {
      factsTokens.push({ key: `${NS}.factsIssuedDateOnly`, params: { date } });
    }
    return { titleToken: { key: `${NS}.titleIssued` }, factsTokens };
  }

  // The explicit no-return basis (no_return_initiated payload). The refund
  // clause is added only when Shopify records no refund at all; a refund
  // entry with no confirmed amount, or an unknown refund state, says nothing.
  if (p.returnStatus === "NO_RETURN") {
    const factsTokens: I18nToken[] = [{ key: `${NS}.factsNoReturn` }];
    if (refundStatement?.kind === "none") {
      factsTokens.push(accountRefundSentence ?? refundStatementTokens(refundStatement).detail);
    }
    return { titleToken: { key: `${NS}.titleNoReturn` }, factsTokens };
  }

  return null;
}
