/**
 * Customer tenure derivation (design §5.1). Left-censored at the shop's
 * coverage boundary — the engine emits `returning` / `first_seen_in_observed_history`
 * / `unknown` and NEVER a bare `new` without a proven full-history signal.
 */

import type { Tenure } from "../types";
import { CUSTOMER_HISTORY_WASHIN_DAYS } from "../config";

export interface TenureInputs {
  customerShopifyId: string | null;
  priorOrdersInWindow: number | null;
  customerFirstSeenAt: string | null; // earliest observed order for this customer
  shopCoverageStart: string | null; // earliest observed order for the shop
  orderCreatedAt: string;
  /** Only true when a reliable full-history first-order/creation date exists. */
  fullHistorySignalAvailable?: boolean;
}

const DAY_MS = 86_400_000;

export function deriveTenure(
  input: TenureInputs,
  washInDays: number = CUSTOMER_HISTORY_WASHIN_DAYS,
): Tenure {
  // No customer identity → cannot decide.
  if (!input.customerShopifyId || input.priorOrdersInWindow === null) return "unknown";

  // An earlier order is observable → definitively returning.
  if (input.priorOrdersInWindow > 0) return "returning";

  // No earlier order found in the window. If we sit inside the wash-in of the
  // coverage boundary, a pre-boundary order cannot be ruled out → unknown.
  if (input.customerFirstSeenAt && input.shopCoverageStart) {
    const firstSeen = Date.parse(input.customerFirstSeenAt);
    const coverageStart = Date.parse(input.shopCoverageStart);
    if (
      Number.isFinite(firstSeen) &&
      Number.isFinite(coverageStart) &&
      firstSeen - coverageStart < washInDays * DAY_MS
    ) {
      return "unknown";
    }
  }

  // No earlier order, comfortably clear of the boundary. This is still NOT a
  // claim of newness unless a reliable full-history signal exists.
  return "first_seen_in_observed_history";
}
