/**
 * Adaptive cadence for the per-shop reconcile schedule.
 *
 * The cron at /api/cron/sync-disputes claims shops by next_reconcile_at.
 * After a sync runs we adjust the interval based on what was found:
 *
 *  - drift detected (created or updated rows) → halve the interval, floor 15m
 *  - clean reconcile (no drift, no errors)    → multiply by 1.5, ceiling 24h
 *  - errors present                            → leave interval alone (the
 *    circuit-breaker handles repeated failures separately)
 *
 * Active shops settle near 15-30 min, dormant shops drift toward 24h.
 * No per-shop cron entries; cadence is just a number on the shop row.
 */

import { getServiceClient } from "@/lib/supabase/server";

const MIN_INTERVAL_S = 15 * 60; // 15 min
const MAX_INTERVAL_S = 24 * 60 * 60; // 24 h
const DRIFT_DIVISOR = 2;
const CLEAN_MULTIPLIER = 1.5;

export interface CadenceInput {
  shopId: string;
  driftDetected: boolean;
  hadErrors: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function nextInterval(
  current: number,
  driftDetected: boolean,
  hadErrors: boolean,
): number {
  if (hadErrors) return current;
  const next = driftDetected
    ? current / DRIFT_DIVISOR
    : current * CLEAN_MULTIPLIER;
  return Math.round(clamp(next, MIN_INTERVAL_S, MAX_INTERVAL_S));
}

/**
 * Update the shop's last_reconciled_at and adjust reconcile_interval_seconds
 * based on whether drift was detected. The next_reconcile_at column is
 * advanced by claim_due_shops at claim time, so we only update interval and
 * last_reconciled_at here.
 */
export async function recordReconcileOutcome({
  shopId,
  driftDetected,
  hadErrors,
}: CadenceInput): Promise<void> {
  const sb = getServiceClient();

  const { data: shop } = await sb
    .from("shops")
    .select("reconcile_interval_seconds")
    .eq("id", shopId)
    .single();
  if (!shop) return;

  const current = shop.reconcile_interval_seconds ?? 3600;
  const next = nextInterval(current, driftDetected, hadErrors);

  await sb
    .from("shops")
    .update({
      last_reconciled_at: new Date().toISOString(),
      reconcile_interval_seconds: next,
    })
    .eq("id", shopId);
}
