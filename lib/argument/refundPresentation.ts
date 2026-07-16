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
 *                                            → "No refund issued" +
 *                                              "the customer never initiated a return"
 *
 * Lib code emits i18n tokens, never English. Returns null when the
 * payload matches neither shape (the caller keeps the generic label).
 */

import type { I18nToken } from "@/lib/i18n/token";
import { shortEvidenceDate } from "@/lib/argument/deliveryPresentation";

const NS = "disputes.refundStatus";

export interface RefundPresentation {
  /** Fact-stating title: "Refund issued" / "No refund issued". */
  titleToken: I18nToken;
  /** Compact facts line(s) answering how much / when / why. */
  factsTokens: I18nToken[];
}

export function buildRefundPresentation(
  payload: Record<string, unknown> | null | undefined,
): RefundPresentation | null {
  const p = payload ?? {};

  // Refund actually issued (refund_record payload).
  if (p.refundStatus === "processed") {
    const amountRaw =
      typeof p.amount === "string"
        ? p.amount.trim()
        : typeof p.amount === "number"
          ? String(p.amount)
          : null;
    const currency = typeof p.currency === "string" ? p.currency.trim() : null;
    const date = shortEvidenceDate(p.refundedAt);
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

  // No refund on the order — either the explicit no-return basis
  // (no_return_initiated payload) or a refund section with nothing
  // refunded.
  if (p.returnStatus === "NO_RETURN") {
    return {
      titleToken: { key: `${NS}.titleNone` },
      factsTokens: [{ key: `${NS}.factsNoReturn` }],
    };
  }
  if (p.refundStatus === "none") {
    return { titleToken: { key: `${NS}.titleNone` }, factsTokens: [] };
  }

  return null;
}
