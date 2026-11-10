/**
 * Coalesce tail for the save_to_shopify handler.
 *
 * A merchant who requests a regenerate while a save is in flight (see
 * `app/api/packs/[packId]/regenerate/route.ts`) sets `rebuild_pending = true`
 * instead of enqueueing a duplicate build. Whoever SETTLES the save must
 * consume it: the success path always did; Track S makes the terminal-failure
 * and refusal paths do the same, otherwise a regenerate requested during a save
 * that then fails is silently lost.
 *
 * Idempotent: an active `build_pack` job for the pack suppresses the insert.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit/logEvent";
import type { ClaimedJob } from "../claimJobs";

export async function runCoalesceTail(args: {
  sb: SupabaseClient;
  job: ClaimedJob;
  packId: string;
  pack: { shop_id: string; dispute_id: string | null };
}): Promise<void> {
  const { sb, job, packId, pack } = args;
  const { data: tailRow } = await sb
    .from("evidence_packs")
    .select("rebuild_pending")
    .eq("id", packId)
    .single();

  if (tailRow?.rebuild_pending) {
    const { data: tailDispute } = await sb
      .from("disputes")
      .select("submission_state")
      .eq("id", pack.dispute_id)
      .single();

    if (tailDispute?.submission_state === "submitted_confirmed") {
      await sb
        .from("evidence_packs")
        .update({
          rebuild_pending: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", packId);
      await logAuditEvent({
        shopId: pack.shop_id,
        disputeId: pack.dispute_id,
        packId,
        actorType: "system",
        eventType: "pack_regenerate_coalesced_skipped_window_closed",
        eventPayload: {
          jobId: job.id,
          packId,
          disputeId: pack.dispute_id,
          trigger: "rebuild_pending_tail",
        },
      });
    } else {
      const { data: activeBuilds } = await sb
        .from("jobs")
        .select("id, status")
        .eq("entity_id", packId)
        .eq("job_type", "build_pack")
        .in("status", ["queued", "running"]);

      if (activeBuilds && activeBuilds.length > 0) {
        await logAuditEvent({
          shopId: pack.shop_id,
          disputeId: pack.dispute_id,
          packId,
          actorType: "system",
          eventType: "pack_regenerate_coalesced_job_already_exists",
          eventPayload: {
            jobId: job.id,
            packId,
            disputeId: pack.dispute_id,
            trigger: "rebuild_pending_tail",
            existingJobIds: activeBuilds.map((j) => j.id as string),
          },
        });
      } else {
        await sb.from("jobs").insert({
          shop_id: pack.shop_id,
          job_type: "build_pack",
          entity_id: packId,
        });
        await logAuditEvent({
          shopId: pack.shop_id,
          disputeId: pack.dispute_id,
          packId,
          actorType: "system",
          eventType: "pack_regenerate_coalesced",
          eventPayload: {
            jobId: job.id,
            packId,
            disputeId: pack.dispute_id,
            trigger: "rebuild_pending_tail",
          },
        });
      }
    }
  }
}
