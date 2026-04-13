import type { OutcomeResult, FinalOutcome } from "./types";

/**
 * Derives final outcome fields from a terminal Shopify status.
 * Returns null if the status is not terminal.
 */
export function deriveFinalOutcome(
  shopifyStatus: string,
  amount: number,
): OutcomeResult | null {
  const map: Record<
    string,
    { outcome: FinalOutcome; recovered: number; lost: number }
  > = {
    won: { outcome: "won", recovered: amount, lost: 0 },
    lost: { outcome: "lost", recovered: 0, lost: amount },
    charge_refunded: { outcome: "refunded", recovered: 0, lost: amount },
    accepted: { outcome: "accepted", recovered: 0, lost: amount },
  };

  const entry = map[shopifyStatus];
  if (!entry) return null;

  return {
    finalOutcome: entry.outcome,
    outcomeAmountRecovered: entry.recovered,
    outcomeAmountLost: entry.lost,
    outcomeSource: "shopify_sync",
    outcomeConfidence: "high",
  };
}
