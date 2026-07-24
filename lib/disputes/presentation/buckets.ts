/**
 * Dashboard operational buckets — mutually exclusive, evaluated in this
 * precedence (plan §4):
 *
 *   1. Closed           — reliably terminal (won/lost/neutral closed).
 *   2. Under review     — transmission confirmed, no outcome yet.
 *   3. Action required  — unresolved, pre-transmission, and a genuine
 *                         merchant task (blocking / requested /
 *                         merchant-resolvable technical_error).
 *   4. Building & monitoring — every remaining unresolved
 *                         pre-transmission dispute (includes
 *                         opportunity and recommended).
 *
 * Because Closed and Under review are evaluated first, a closed or
 * under-review dispute with stale attention data can never land in
 * Action required. Every dispute lands in exactly one bucket.
 *
 * Population scope (decided §12V): the three open buckets are
 * point-in-time snapshots over all unresolved disputes; the Closed
 * card is windowed by the selected reporting period (`closed_at` in
 * window) — that windowing is applied by the stats layer, not here.
 */

import type { DashboardBucket, DisputePresentation } from "./types";

export function dashboardBucket(p: DisputePresentation): DashboardBucket {
  if (p.terminal) return "closed";
  if (p.transmissionConfirmed) return "under_review";
  if (p.needsMerchantAction) return "action_required";
  return "building_monitoring";
}
