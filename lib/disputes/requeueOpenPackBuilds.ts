/**
 * Queue a rebuild of the latest pack for every open, not-yet-sent dispute of
 * a shop with a live deadline. Used when a shop setting changes how its
 * evidence scores (Fix C4: returns outside Shopify), so the packs the
 * merchant is looking at reflect the new setting.
 *
 * Same scope as the credit-arrival sweep (`replayBlockedBuilds`): open,
 * `not_saved`, future deadline, capped. Only disputes that already have a
 * pack — a pack-less dispute is the sweep's job, not this one's.
 */

import { getServiceClient } from "@/lib/supabase/server";

const CAP = 200;

export async function requeueOpenPackBuilds(shopId: string): Promise<string[]> {
  const sb = getServiceClient();
  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id")
    .eq("shop_id", shopId)
    .eq("submission_state", "not_saved")
    .is("closed_at", null)
    .gt("due_at", new Date().toISOString())
    .limit(CAP);
  if (error) throw new Error(`requeueOpenPackBuilds: ${error.message}`);
  const ids = (disputes ?? []).map((d) => d.id as string);
  if (!ids.length) return [];

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
  const packIds = [...latest.values()];
  if (!packIds.length) return [];

  const { error: jErr } = await sb.from("jobs").insert(
    packIds.map((packId) => ({ shop_id: shopId, job_type: "build_pack", entity_id: packId })),
  );
  if (jErr) throw new Error(`requeueOpenPackBuilds jobs: ${jErr.message}`);
  return packIds;
}
