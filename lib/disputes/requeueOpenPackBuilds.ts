/**
 * Queue a rebuild of the latest pack for every open, not-yet-sent dispute of
 * a shop with a live deadline. Used when a shop setting changes how its
 * evidence scores (Fix C4: returns outside Shopify), so the packs the
 * merchant is looking at reflect the new setting.
 *
 * Same scope as the credit-arrival sweep (`replayBlockedBuilds`): open,
 * `not_saved`, future deadline, capped. Only disputes that already have a
 * pack — a pack-less dispute is the sweep's job, not this one's.
 *
 * SIZED TO THE DAILY LETTER BUDGET. Every rebuild of an open case asks counsel
 * for a new letter, and counsel has a per-shop daily run cap. Mein Maison
 * 2026-09-30: the toggle queued ~20 rebuilds at once, the cap ran out, and the
 * last two cases got `daily_cap_reached` packages on top of their letters.
 * Now the soonest-due cases run today, up to the remaining budget; the rest
 * are queued for the following days (`run_at` just after the 00:00 UTC
 * reset), one day's cap at a time.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { readGenerationBudget, fitBatchToBudget } from "@/lib/defence/generationBudget";
import { COUNSEL_DAILY_RUN_CAP } from "@/lib/defence/counsel/run";

const CAP = 200;

/** Minutes after the 00:00 UTC cap reset that a deferred rebuild runs. */
const DEFERRED_OFFSET_MINUTES = 30;

export interface RequeueResult {
  /** Packs queued to rebuild now. */
  queued: string[];
  /** Packs queued for a later day, with when they run. */
  deferred: Array<{ packId: string; runAt: string }>;
}

/** When the `index`-th deferred pack runs: day 1 takes the first
 *  `perDay`, day 2 the next, each just after that day's cap reset. */
export function deferredRunAt(now: Date, index: number, perDay: number): string {
  const day = 1 + Math.floor(index / Math.max(1, perDay));
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, 0, DEFERRED_OFFSET_MINUTES));
  return at.toISOString();
}

export async function requeueOpenPackBuilds(shopId: string, now: Date = new Date()): Promise<RequeueResult> {
  const sb = getServiceClient();
  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id")
    .eq("shop_id", shopId)
    .eq("submission_state", "not_saved")
    .is("closed_at", null)
    .gt("due_at", now.toISOString())
    // Soonest deadline first: today's budget goes to the cases due soonest.
    .order("due_at", { ascending: true })
    .limit(CAP);
  if (error) throw new Error(`requeueOpenPackBuilds: ${error.message}`);
  const ids = (disputes ?? []).map((d) => d.id as string);
  if (!ids.length) return { queued: [], deferred: [] };

  const { data: packs, error: pErr } = await sb
    .from("evidence_packs")
    .select("id, dispute_id, status, created_at")
    .in("dispute_id", ids)
    .not("status", "in", "(archived,failed,building,queued)")
    .order("created_at", { ascending: false });
  if (pErr) throw new Error(`requeueOpenPackBuilds packs: ${pErr.message}`);

  const latest = new Map<string, string>();
  for (const p of packs ?? []) {
    if (!latest.has(p.dispute_id as string)) latest.set(p.dispute_id as string, p.id as string);
  }
  // In deadline order (the `ids` order), not pack-creation order.
  const packIds = ids.map((id) => latest.get(id)).filter((x): x is string => !!x);
  if (!packIds.length) return { queued: [], deferred: [] };

  const { batch, deferred } = fitBatchToBudget(packIds, await readGenerationBudget(shopId));
  const later = deferred.map((packId, i) => ({ packId, runAt: deferredRunAt(now, i, COUNSEL_DAILY_RUN_CAP) }));

  const { error: jErr } = await sb.from("jobs").insert([
    ...batch.map((packId) => ({ shop_id: shopId, job_type: "build_pack", entity_id: packId })),
    ...later.map(({ packId, runAt }) => ({ shop_id: shopId, job_type: "build_pack", entity_id: packId, run_at: runAt })),
  ]);
  if (jErr) throw new Error(`requeueOpenPackBuilds jobs: ${jErr.message}`);
  return { queued: batch, deferred: later };
}
