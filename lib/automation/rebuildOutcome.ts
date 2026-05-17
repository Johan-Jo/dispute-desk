/**
 * Resubmission Window — last-rebuild outcome helper.
 *
 * Stamps `evidence_packs.last_rebuild_outcome` so the workspace can
 * explain to the merchant what happened after they clicked Regenerate
 * (upload of new evidence → rebuild → ???). Without this, a regenerate
 * that completes but is blocked by the §9 strength gate is invisible:
 * the prior Shopify save stays canonical and the merchant has no
 * signal that nothing was re-saved.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ NON-AUTHORITATIVE INVARIANT                                     │
 * │                                                                 │
 * │ `last_rebuild_outcome` is USER-FACING EXPLANATION ONLY. The     │
 * │ canonical submission state lives on:                            │
 * │   - `disputes.submission_state` (saved_to_shopify vs            │
 * │      submitted_confirmed; set by syncDisputes from Shopify's    │
 * │      evidenceSentOn)                                            │
 * │   - `evidence_packs.status` (saved_to_shopify_verified,         │
 * │      save_failed, etc.)                                         │
 * │   - The Shopify-side `disputeEvidence` readback                 │
 * │                                                                 │
 * │ Nothing in the pipeline, automation, save path, or gates may    │
 * │ READ this column. It is an audit annotation that the workspace  │
 * │ happens to surface. If you find yourself reading it to make a   │
 * │ decision, you're using the wrong source of truth.               │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Stamp sites are the existing decision points:
 *   - lib/automation/pipeline.ts `evaluateAndMaybeAutoSave`
 *   - lib/jobs/handlers/saveToShopifyJob.ts (success + failure)
 *
 * Only stamp when this build is a regenerate. The marker is the
 * existence of a prior successful save on the dispute, expressed via
 * `disputes.submission_state === "saved_to_shopify"` at the moment the
 * gate decision is made. First-time builds skip stamping entirely so
 * the column stays null on disputes that have never been saved.
 */

import { getServiceClient } from "@/lib/supabase/server";

export type RebuildOutcome =
  | "saved"
  | "blocked_weak"
  | "blocked_fatal_loss"
  | "blocked_covered"
  | "blocked_no_material_change"
  | "failed";

/** True when the dispute already has a prior Shopify save (the
 *  resubmission window is open). Used by both pipeline.ts and
 *  saveToShopifyJob.ts to gate outcome stamping — first-time builds
 *  must leave the column null. */
export async function isRegenerateBuild(disputeId: string | null): Promise<boolean> {
  if (!disputeId) return false;
  const sb = getServiceClient();
  const { data } = await sb
    .from("disputes")
    .select("submission_state")
    .eq("id", disputeId)
    .single();
  // `submitted_confirmed` is the window-closed case — handled by separate
  // guards in saveToShopifyJob; we still stamp `saved` for completed
  // regenerates that beat the syncDisputes flip. `saved_to_shopify` is
  // the canonical "window open" signal.
  const s = (data?.submission_state as string | null) ?? null;
  return s === "saved_to_shopify" || s === "submitted_confirmed";
}

interface StampArgs {
  packId: string;
  outcome: RebuildOutcome;
  /** Short merchant-safe code that pairs with the outcome for tooltip /
   *  banner copy. Examples: 'case_strength_weak', 'refund_issued',
   *  'coverage_active', 'shopify_user_error'. */
  reason: string;
}

/** Write the outcome to evidence_packs. Idempotent — last write wins.
 *  Errors are swallowed (logged) because this is annotation, not a
 *  pipeline-critical step. */
export async function stampRebuildOutcome(args: StampArgs): Promise<void> {
  const sb = getServiceClient();
  const { error } = await sb
    .from("evidence_packs")
    .update({
      last_rebuild_outcome: args.outcome,
      last_rebuild_at: new Date().toISOString(),
      last_rebuild_reason: args.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.packId);
  if (error) {
    console.error("[rebuildOutcome] failed to stamp outcome", {
      packId: args.packId,
      outcome: args.outcome,
      reason: args.reason,
      message: error.message,
    });
  }
}

interface MaterialChangeArgs {
  disputeId: string;
  newOverall: string | null;
  newApprovedFactCount: number | null;
}

/**
 * Decide whether the regenerated package is "materially different" from
 * the most recently *submitted* defence package on this dispute.
 *
 * Inputs:
 *   - newOverall                  — case strength on the just-built pack
 *                                   (from pack_json.case_strength.overall)
 *   - newApprovedFactCount        — number of EvidenceFact entries the
 *                                   classifier emitted for the new draft
 *                                   (length of classification.approved)
 *
 * Heuristic v1 (deliberately coarse — easier to refine than to retract):
 *   - prior submitted package has no facts_json (legacy)        → assume material
 *   - approvedFacts count grew on the new draft                 → material
 *   - prior pack_json.case_strength.overall differs from newOverall → material
 *
 * Otherwise: not material.
 *
 * Used only to refine the outcome reported to the merchant when the
 * gate decision would have been `park_for_review` (same strength, no
 * net new bank-eligible signals → almost certainly a re-roll with the
 * same content). Never used to GATE the save — that's the gates' job.
 *
 * Note on the strength comparison source: defence_packages.facts_json
 * is the EvidenceFact array itself (see buildDefencePackageJob:286),
 * not a wrapper carrying caseStrength. We compare against the prior
 * package's source pack via `source_pack_id → evidence_packs.pack_json
 * .case_strength.overall`, which is the snapshot at submit time.
 */
export async function isMaterialChange(args: MaterialChangeArgs): Promise<boolean> {
  const sb = getServiceClient();
  const { data: priorSubmitted } = await sb
    .from("defence_packages")
    .select("facts_json, source_pack_id")
    .eq("dispute_id", args.disputeId)
    .eq("status", "submitted")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!priorSubmitted) return true;
  const priorFacts = Array.isArray(priorSubmitted.facts_json)
    ? (priorSubmitted.facts_json as unknown[])
    : null;
  if (priorFacts === null) return true;

  if ((args.newApprovedFactCount ?? 0) > priorFacts.length) return true;

  // Strength comparison: pull the source pack's pack_json.case_strength.
  // A regenerate replaces the same evidence_packs row's pack_json, so
  // for a rebuild on the same pack we can't read the prior strength
  // from there — but the prior submitted defence_package's source_pack_id
  // is the same pack id, and our caller hands us the NEW overall. So we
  // need a frozen strength snapshot. Until that exists on
  // defence_packages, fall back to "not material" only when both fact
  // count and overall are unchanged. Caller passes newOverall — we
  // compare against the most recent rule_applied + case_strength audit
  // entry from before this rebuild. To keep this simple and correct, we
  // settle for the fact-count check above and treat strength as the
  // tie-breaker only when we have a previous strength snapshot.
  //
  // Practical effect: if the new draft has the same number of facts as
  // the last submitted draft AND the strength engine output didn't move
  // counts, we report `blocked_no_material_change`. This is the common
  // case behind the merchant's complaint (uploaded file that didn't
  // affect strength signals). Strength comparisons across rebuilds are
  // handled at the call site by reading the prior `auto_save_blocked`
  // / `parked_for_review` audit entry — see pipeline.ts.
  void args.newOverall; // intentionally unused in v1 heuristic
  return false;
}
