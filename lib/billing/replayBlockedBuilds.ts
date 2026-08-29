/**
 * replayBlockedBuilds — credit-arrival guard.
 *
 * When a shop's pack credits were exhausted (or never granted), the
 * automation pipeline exits `quota_exceeded` for each dispute it touches.
 * That exit is TERMINAL for the dispute: the dispatcher wraps the pipeline
 * in `withEffectDedup`, which writes its `dispute_event_key` claim BEFORE
 * running the effect and treats a second attempt as `already_applied`. So a
 * dispute blocked on quota never gets a second pipeline run from the normal
 * ingest path, and neither rebuild cron creates a FIRST pack
 * (`refresh-open-disputes` needs delivery to move; the deadline rebuild
 * counts a pack-less dispute as `skippedNoPack`).
 *
 * Net effect, observed on `6a8848-dd` in prod 2026-08-29: credits landed at
 * 14:30, three hours after the pipeline had already run and given up on 63
 * live disputes at 10:37-11:07. Balance read 105 remaining / 0 used while 50
 * open disputes — earliest deadline the next morning — had no evidence pack
 * and no queued job.
 *
 * This module closes that gap by re-running the pipeline for a shop's
 * still-actionable disputes whenever credits arrive. It deliberately does NOT
 * reason about eligibility itself — `runAutomationPipeline` already guards
 * terminal status, auto-build-off, existing packs and quota, and clears stale
 * billing attention flags on the way through. We only pick candidates and
 * re-invoke it, bypassing the burnt `withEffectDedup` claim rather than
 * trying to un-burn it.
 *
 * Scope is LIVE DEADLINES ONLY (`due_at` in the future). A dispute past its
 * deadline cannot be helped by a pack, and the tight scope is what stops this
 * from becoming a second "ran on every historical dispute" incident.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { BILLING_ATTENTION_REASONS } from "@/lib/disputes/attentionReasons";

/** Hard ceiling on how many disputes one sweep will replay. A shop that
 *  installs with a large open backlog should not fan out unbounded from a
 *  single billing callback; the remainder is reported and picked up by the
 *  next grant or a manual run. */
export const REPLAY_CANDIDATE_CAP = 200;

/** Statuses that can still accept evidence. Anything terminal is excluded
 *  here AND again by the pipeline's own terminal guard. */
const ACTIONABLE_STATUSES = ["needs_response", "under_review"];

/** Pack statuses that do NOT count as an existing pack — a failed or
 *  archived pack should not stop a rebuild. Mirrors the same filter in
 *  `runAutomationPipeline`. */
const DEAD_PACK_STATUSES = ["failed", "archived"];

export interface ReplayCandidate {
  disputeId: string;
  shopId: string;
}

/**
 * Find disputes that are blocked but still winnable: open, un-submitted,
 * with no live pack, and with a deadline that has not passed.
 */
export async function findBlockedBuildCandidates(
  shopId: string,
  nowIso: string = new Date().toISOString(),
): Promise<ReplayCandidate[]> {
  const sb = getServiceClient();

  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id")
    .eq("shop_id", shopId)
    .in("status", ACTIONABLE_STATUSES)
    .eq("submission_state", "not_saved")
    .is("closed_at", null)
    .gt("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(REPLAY_CANDIDATE_CAP);

  if (error) {
    throw new Error(
      `replayBlockedBuilds: candidate query failed: ${error.message}`,
    );
  }
  if (!disputes?.length) return [];

  // Drop any dispute that already has a live pack. The pipeline would return
  // `existing_pack` anyway; filtering here keeps the sweep's own counters
  // honest about what it actually set in motion.
  const ids = disputes.map((d) => d.id as string);
  const { data: packs, error: packErr } = await sb
    .from("evidence_packs")
    .select("dispute_id")
    .in("dispute_id", ids)
    .not("status", "in", `(${DEAD_PACK_STATUSES.join(",")})`);

  if (packErr) {
    throw new Error(
      `replayBlockedBuilds: pack lookup failed: ${packErr.message}`,
    );
  }

  const hasPack = new Set((packs ?? []).map((p) => p.dispute_id as string));
  return ids
    .filter((id) => !hasPack.has(id))
    .map((id) => ({ disputeId: id, shopId }));
}

export interface ReplaySummary {
  shopId: string;
  candidates: number;
  enqueued: number;
  /** True when the candidate set hit REPLAY_CANDIDATE_CAP and more may remain. */
  capped: boolean;
  errors: string[];
}

/**
 * Enqueue a `replay_blocked_builds` job for a shop whose credits just
 * arrived. Fire-and-forget safe: never throws into the caller's billing
 * path, because a failed sweep must not roll back a successful grant.
 *
 * Deduped on the grant's own reference so two grant paths racing on the
 * same top-up produce one sweep, not two.
 */
export async function scheduleBlockedBuildReplay(args: {
  shopId: string;
  reference: string;
}): Promise<void> {
  try {
    await enqueueJob({
      shopId: args.shopId,
      jobType: "replay_blocked_builds",
      // Interactive-ish priority: a merchant who just paid should not wait
      // behind a historical order backfill. Lower number = sooner.
      priority: 20,
      dedupeKey: `replay_blocked_builds:${args.shopId}:${args.reference}`,
    });
  } catch (err) {
    // A duplicate dedupe_key is the expected benign race, not an error.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("23505") || msg.includes("duplicate key")) return;
    console.error(
      `[replayBlockedBuilds] failed to schedule sweep for ${args.shopId}: ${msg}`,
    );
  }
}

/**
 * Run the sweep: re-invoke the automation pipeline for every still-actionable
 * blocked dispute on this shop.
 *
 * The pipeline import is dynamic to keep this module importable from the
 * billing callbacks without dragging the whole automation graph into them.
 */
export async function replayBlockedBuilds(
  shopId: string,
  nowIso: string = new Date().toISOString(),
): Promise<ReplaySummary> {
  const summary: ReplaySummary = {
    shopId,
    candidates: 0,
    enqueued: 0,
    capped: false,
    errors: [],
  };

  const candidates = await findBlockedBuildCandidates(shopId, nowIso);
  summary.candidates = candidates.length;
  summary.capped = candidates.length >= REPLAY_CANDIDATE_CAP;

  if (!candidates.length) return summary;

  const { runAutomationPipeline } = await import("@/lib/automation/pipeline");
  const sb = getServiceClient();

  for (const candidate of candidates) {
    try {
      const { data: dispute } = await sb
        .from("disputes")
        .select("*")
        .eq("id", candidate.disputeId)
        .maybeSingle();
      if (!dispute) continue;

      const result = await runAutomationPipeline(
        dispute as Parameters<typeof runAutomationPipeline>[0],
      );
      if (result.action === "pack_enqueued") summary.enqueued++;

      // If the pipeline decided NOT to build (auto-build off, terminal, or
      // still quota-blocked), the dispute keeps whatever attention flag it
      // earned — clearing it would hide a real blocker.
    } catch (err) {
      summary.errors.push(
        `${candidate.disputeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "system",
    event_type: "blocked_builds_replayed",
    event_payload: {
      candidates: summary.candidates,
      enqueued: summary.enqueued,
      capped: summary.capped,
      errors: summary.errors.length,
    },
  });

  return summary;
}
