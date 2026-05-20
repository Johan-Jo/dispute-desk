/**
 * Adaptive cadence for the per-shop reconcile schedule.
 *
 * The cron at /api/cron/sync-disputes claims shops by next_reconcile_at.
 * After a sync runs we adjust the interval based on what was found:
 *
 *  - drift detected (created or updated rows) → halve the interval, floor 1h
 *  - clean reconcile (no drift, no errors)    → multiply by 1.5, ceiling 6h
 *  - errors present                            → leave interval alone (the
 *    circuit-breaker handles repeated failures separately)
 *
 * Since 2026-05-20 the disputes/create + disputes/update webhooks are the
 * primary state-propagation path. Cron is reconciliation only, so the
 * cadence range was widened: floor 1h (was 15m), ceiling 6h (was 24h). The
 * floor stays well under Shopify's 48h retry envelope so a missed webhook
 * is still caught within an hour. The ceiling caps how stale a dormant shop
 * can get in case both layers fail silently.
 */

import { getServiceClient } from "@/lib/supabase/server";

const MIN_INTERVAL_S = 60 * 60; // 1 h — primary path is webhooks
const MAX_INTERVAL_S = 6 * 60 * 60; // 6 h — bounded safety net
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
