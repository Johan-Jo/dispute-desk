/**
 * May a shop's FIRST month records be written yet?
 * (docs/plans/insights-first-day-gaps.plan.md §3.1)
 *
 * Asked only for a shop with no `ratio_snapshots` row at all. Disputes drive
 * the headline counts, so a month written before the shop's dispute history
 * has arrived would be marked final with zero chargebacks. A shop that already
 * has records is never asked: its nightly maintenance runs as before.
 *
 * "Disputes have arrived" = at least one `sync_disputes` job succeeded. The
 * handler throws on any reported error, so `succeeded` is an error-free walk.
 * `shops.last_reconciled_at` is not used: it is stamped after failed and
 * partial syncs too.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** After this long without a successful dispute sync the records are written
 *  anyway, with an ops alert. Nothing fires at this hour by itself: the
 *  nightly cron is what notices, so the real bound is 24–48 hours. */
export const FORCE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface FirstMaterializationShop {
  id: string;
  historical_import_status: string | null;
  historical_import_completed_at: string | null;
}

export interface FirstMaterialization {
  ok: boolean;
  reason?: "import" | "disputes";
  /** Written without a successful dispute sync; the caller alerts ops. */
  forced?: boolean;
}

export async function canMaterializeFirst(
  sb: SupabaseClient,
  shop: FirstMaterializationShop,
  now: Date,
): Promise<FirstMaterialization> {
  if (shop.historical_import_status !== "complete" || !shop.historical_import_completed_at) {
    return { ok: false, reason: "import" };
  }

  const { data, error } = await sb
    .from("jobs")
    .select("id")
    .eq("shop_id", shop.id)
    .eq("job_type", "sync_disputes")
    .eq("status", "succeeded")
    .limit(1);
  if (error) throw new Error(`sync_disputes jobs: ${error.message}`);
  if ((data ?? []).length > 0) return { ok: true };

  const waited = now.getTime() - new Date(shop.historical_import_completed_at).getTime();
  if (waited > FORCE_AFTER_MS) return { ok: true, forced: true };
  return { ok: false, reason: "disputes" };
}
