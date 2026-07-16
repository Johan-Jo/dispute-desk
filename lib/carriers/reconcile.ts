/**
 * Cross-source delivery-state reconciliation — plan §5.7.
 *
 * Sources (carrier API, tracking-app metafields, Shopify-native events,
 * cached carrier results) are never trusted by arrival order. The current
 * authoritative terminal state for a shipment is the NEWEST sufficiently
 * reliable terminal event:
 *   - a later `Returned` beats an older `Delivered` (no stale positives);
 *   - a later redelivery supersedes an earlier return;
 *   - `DeliveredToPickup` stays distinct from `Delivered`;
 *   - conflicts are surfaced, never silently discarded;
 *   - ABSENCE of a signal never overrides an existing positive one —
 *     reconcile only ever receives present signals.
 */

import type { CarrierDeliveryStatus } from "@/lib/carriers/types";

export interface DeliverySignal {
  status: CarrierDeliveryStatus;
  /** ISO timestamp of the terminal event. Null = undated (treated as
   *  older than any dated signal — a dated event is more reliable). */
  at: string | null;
  /** Provenance: "shopify_native" | tracking-app slug | "carrier_api_<slug>". */
  source: string;
}

export interface ReconciledDelivery {
  /** The authoritative current state, or null when no signal exists. */
  current: DeliverySignal | null;
  /** True when present signals disagree on the terminal status —
   *  surfaced to admin provenance, never silently dropped. */
  conflict: boolean;
}

function isCarrierApi(source: string): boolean {
  return source.startsWith("carrier_api");
}

/** Newest-dated signal wins; undated signals lose to dated ones; on a
 *  timestamp tie (or two undated), the carrier API's own record of its
 *  shipment outranks secondhand sources. */
export function reconcileDeliveryState(
  signals: Array<DeliverySignal | null | undefined>,
): ReconciledDelivery {
  const present = signals.filter((s): s is DeliverySignal => !!s);
  if (present.length === 0) return { current: null, conflict: false };

  let current = present[0];
  for (const s of present.slice(1)) {
    const a = s.at ?? "";
    const b = current.at ?? "";
    if (a > b) {
      current = s;
    } else if (a === b && isCarrierApi(s.source) && !isCarrierApi(current.source)) {
      current = s;
    }
  }
  const conflict = new Set(present.map((s) => s.status)).size > 1;
  return { current, conflict };
}
