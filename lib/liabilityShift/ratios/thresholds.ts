/**
 * Re-export of the one card-programme threshold table.
 *
 * This file used to carry its own numbers (Visa "standard" 0.65%, Mastercard
 * ECM 1.00%) that disagreed with the checkpoints on the same page. They are
 * gone; `lib/insights/programmeThresholds.ts` is the only source.
 */

export {
  VAMP_EARLY_WARNING,
  VAMP_EXCESSIVE,
  VAMP_COUNT_FLOOR,
  MC_ECM_RATIO,
  MC_ECM_COUNT_FLOOR,
  VAMP_PER_TRANSACTION_FEE_USD,
  vampSeverity,
  ecmSeverity,
} from "@/lib/insights/programmeThresholds";
