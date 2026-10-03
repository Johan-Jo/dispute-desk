/**
 * Whether a recomputed month differs from its stored row in a way a merchant
 * would see. Post-statement refunds nudge the denominator every night; a
 * revision (and a "Revised since your email" line) for 0.2134% → 0.2131% is
 * noise. A changed chargeback count, a headline that reads differently at
 * display precision (2 dp of a percent), or a change in whether card framing
 * applies is not.
 */

import type { ProgrammeBlock } from "./computeProgrammeBlock";

export interface StoredMonth {
  card_chargeback_count: number | null;
  visa_chargeback_count: number | null;
  mc_chargeback_count: number | null;
  card_dispute_ratio: number | string | null;
  mc_ecm_ratio: number | string | null;
  card_framing_applies: boolean | null;
}

const display = (r: number | string | null | undefined): string =>
  r === null || r === undefined ? "—" : (Number(r) * 100).toFixed(2);

export function driftIsMaterial(stored: StoredMonth, fresh: ProgrammeBlock): boolean {
  return (
    (stored.card_chargeback_count ?? -1) !== fresh.cardChargebackCount ||
    (stored.visa_chargeback_count ?? -1) !== fresh.visaChargebackCount ||
    (stored.mc_chargeback_count ?? -1) !== fresh.mcChargebackCount ||
    display(stored.card_dispute_ratio) !== display(fresh.cardDisputeRatio) ||
    display(stored.mc_ecm_ratio) !== display(fresh.ecmRatio) ||
    (stored.card_framing_applies ?? null) !== fresh.cardFramingApplies
  );
}
